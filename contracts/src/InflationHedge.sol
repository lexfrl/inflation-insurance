// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title InflationHedge
/// @notice IPC Shield core contract. Parametric inflation-protection product:
///         LPs fund a per-period pool, buyers pay a premium for a policy that
///         pays out based on how far the settled CPI print exceeds their
///         chosen strike (capped per period). Settled and collateralized in
///         USDT.
///
///         Differentiation from a binary prediction market (e.g. Polymarket):
///         payout scales continuously with the size of the inflation shock,
///         instead of resolving to a fixed $1 / $0 on a single threshold.
///         Pricing (see `quote`) integrates a full CPI outcome distribution
///         (`cpiBucketsBps` / `probBps`) rather than pricing one YES/NO event.
///
///         Liquidity that nobody has bought protection against sits idle for
///         the length of a CPI period. `investIdle` deploys exactly that
///         unsold capacity into an ERC-4626 yield venue (a Morpho vault) so
///         LPs earn a base rate on top of the underwriting premium, which is
///         what makes underwriting worth doing before the pool has volume.
///
/// @dev V1 trust model: CPI settlement is posted by a single trusted owner
///      address (`postSettlement`). No decentralized oracle. See
///      `IInflationOracle` for the V2 seam this would plug into (INDEC ->
///      resolver -> this contract), and the README for the full roadmap
///      (factory-per-pool, market-derived pricing, ERC721 policies).
///
/// @dev The yield venue is deliberately kept out of every buyer code path.
///      `quote`, `buyPolicy`, `claim` and `postSettlement` never touch the
///      vault, and `investIdle` never deploys more than the pool holds in
///      excess of `totalMaxLiability`. A vault that is illiquid, gated or
///      lossy can therefore only ever cost LPs -- it can never stop a
///      policyholder from claiming what they are owed.
contract InflationHedge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOM = 10_000;

    struct CreatePeriodParams {
        string label;
        uint256 capBps;
        uint256 saleEnd;
        uint256 periodEnd;
        uint256 claimWindowSecs; // claim window duration, starts counting at settlement
        uint256 loadBps; // e.g. 12_000 = premium is 1.2x the raw expected value
        uint256[] cpiBucketsBps; // discrete CPI outcomes this period's histogram covers
        uint256[] probBps; // matching probabilities, must sum to BPS_DENOM
    }

    struct Period {
        string label;
        uint256 capBps;
        uint256 saleEnd;
        uint256 periodEnd;
        uint256 claimWindowSecs;
        uint256 claimDeadline; // 0 until settled; set to settledAt + claimWindowSecs
        uint256 loadBps;
        uint256[] cpiBucketsBps;
        uint256[] probBps;
        uint256 totalCollateral;
        uint256 totalPremiums;
        uint256 totalMaxLiability;
        uint256 totalShares;
        uint256 settlementCpiBps;
        bool settled;
        uint256 totalClaimed;
        // Yield-vault bookkeeping. All zero unless `investIdle` ran, which is
        // what makes every pre-existing period behave exactly as it did before.
        address vaultUsed; // vault this period actually deposited into
        uint256 vaultShares; // ERC-4626 shares still held for this period
        uint256 vaultPrincipal; // USDT sent to the vault
        uint256 vaultProceeds; // USDT redeemed back from the vault
    }

    struct Policy {
        uint256 periodId;
        address owner;
        uint256 notional;
        uint256 strikeBps;
        uint256 maxPayout;
        uint256 premiumPaid;
        bool claimed;
    }

    IERC20 public immutable usdt;

    // ERC-4626 venue idle capital is parked in, e.g. a Morpho vault.
    // address(0) -- the deployed default -- disables the integration entirely.
    IERC4626 public vault;
    // Ceiling, in bps, on how much of a period's *unsold* capacity
    // `investIdle` may deploy. It never applies to sold capacity: that is
    // already excluded before this multiplier is reached.
    uint256 public investBps;

    mapping(uint256 => Period) private _periods;
    uint256 public periodCount;

    mapping(uint256 => Policy) private _policies;
    uint256 public policyCount;
    mapping(address => uint256[]) private _policiesOf;

    // periodId => lp => shares (1:1 with USDT deposited, pre-settlement)
    mapping(uint256 => mapping(address => uint256)) public lpShares;
    // periodId => lp => already withdrew (one withdrawal per LP per period)
    mapping(uint256 => mapping(address => bool)) public lpWithdrawn;

    event PeriodCreated(
        uint256 indexed periodId,
        string label,
        uint256 capBps,
        uint256 saleEnd,
        uint256 periodEnd,
        uint256 claimWindowSecs,
        uint256 loadBps
    );
    event Deposited(uint256 indexed periodId, address indexed lp, uint256 amount, uint256 shares);
    event PolicyBought(
        uint256 indexed policyId,
        uint256 indexed periodId,
        address indexed buyer,
        uint256 notional,
        uint256 strikeBps,
        uint256 premium,
        uint256 maxPayout
    );
    event SettlementPosted(uint256 indexed periodId, uint256 cpiBps, uint256 claimDeadline);
    event Claimed(uint256 indexed policyId, address indexed buyer, uint256 payout);
    event Withdrawn(uint256 indexed periodId, address indexed lp, uint256 amount);
    event VaultSet(address indexed vault);
    event InvestBpsSet(uint256 investBps);
    event Invested(uint256 indexed periodId, address indexed vault, uint256 assets, uint256 shares);
    event Divested(uint256 indexed periodId, address indexed vault, uint256 shares, uint256 assets);

    constructor(IERC20 usdt_) Ownable(msg.sender) {
        usdt = usdt_;
        // 100% is the honest default because this is a cap on `idle`, and
        // `idle` is itself already the safety boundary -- it excludes every
        // USDT a buyer could ever claim. The real off switch is `vault ==
        // address(0)`, which is what this contract deploys with. Defaulting
        // to 0 instead would make a freshly-configured pool revert with
        // "nothing to invest", which reads like a bug rather than a policy.
        investBps = BPS_DENOM;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Points idle capital at an ERC-4626 yield venue. `address(0)`
    ///         disables the integration; that is the deployed default.
    /// @dev Repointing this never disturbs a period that is already invested.
    ///      Each period records the vault it actually deposited into
    ///      (`Period.vaultUsed`) and `divest` redeems from *that* one, not
    ///      from whatever `vault` happens to be now. Without that pin the bug
    ///      is real and silent: this contract holds ONE pooled share balance,
    ///      so after repointing, `divest` on an old period would burn a newer
    ///      period's shares of the new vault and credit the proceeds to the
    ///      wrong pool.
    function setVault(IERC4626 newVault) external onlyOwner {
        // A vault denominated in anything but this pool's collateral would
        // take the approval in `investIdle` and then either revert or, worse,
        // settle in a token this contract has no accounting for. One `asset()`
        // read turns a fat-fingered address from a fund-loss event into a
        // failed transaction.
        require(address(newVault) == address(0) || newVault.asset() == address(usdt), "vault asset mismatch");

        vault = newVault;

        emit VaultSet(address(newVault));
    }

    function setInvestBps(uint256 newInvestBps) external onlyOwner {
        require(newInvestBps <= BPS_DENOM, "bad invest bps");

        investBps = newInvestBps;

        emit InvestBpsSet(newInvestBps);
    }

    function createPeriod(CreatePeriodParams calldata p) external onlyOwner returns (uint256 periodId) {
        require(p.capBps > 0 && p.capBps <= BPS_DENOM, "bad cap");
        require(p.saleEnd > block.timestamp, "saleEnd in past");
        require(p.periodEnd >= p.saleEnd, "periodEnd < saleEnd");
        require(p.claimWindowSecs > 0, "claim window must be > 0");
        require(p.loadBps >= BPS_DENOM, "load must be >= 1x");
        require(p.cpiBucketsBps.length > 0, "empty histogram");
        require(p.cpiBucketsBps.length == p.probBps.length, "length mismatch");

        uint256 probSum;
        for (uint256 i = 0; i < p.probBps.length; i++) {
            probSum += p.probBps[i];
        }
        require(probSum == BPS_DENOM, "probabilities must sum to 10000");

        periodId = periodCount++;
        Period storage period = _periods[periodId];
        period.label = p.label;
        period.capBps = p.capBps;
        period.saleEnd = p.saleEnd;
        period.periodEnd = p.periodEnd;
        period.claimWindowSecs = p.claimWindowSecs;
        period.loadBps = p.loadBps;
        period.cpiBucketsBps = p.cpiBucketsBps;
        period.probBps = p.probBps;

        emit PeriodCreated(periodId, p.label, p.capBps, p.saleEnd, p.periodEnd, p.claimWindowSecs, p.loadBps);
    }

    /// @notice Posts the settled CPI print and opens the claim window.
    /// @dev The claim window is derived from *this call's* timestamp, not an
    ///      independent deadline fixed at period creation: `claimDeadline =
    ///      block.timestamp + claimWindowSecs`. This is deliberate -- an
    ///      earlier version stored `claimDeadline` as an absolute timestamp
    ///      set at `createPeriod` time, so a late settlement (posted after
    ///      that fixed deadline had already passed) could permanently lock
    ///      buyers out of `claim()` while `withdraw()` was immediately
    ///      callable, letting LPs walk off with premiums that should have
    ///      paid out. Deriving the deadline here means claim() is always
    ///      reachable for `claimWindowSecs` after settlement actually posts,
    ///      no matter how late that is.
    function postSettlement(uint256 periodId, uint256 cpiBps) external onlyOwner {
        Period storage period = _periods[periodId];
        require(period.saleEnd != 0, "no such period");
        require(block.timestamp >= period.periodEnd, "period not ended");
        require(!period.settled, "already settled");

        period.settlementCpiBps = cpiBps;
        period.settled = true;
        period.claimDeadline = block.timestamp + period.claimWindowSecs;

        emit SettlementPosted(periodId, cpiBps, period.claimDeadline);
    }

    // ---------------------------------------------------------------------
    // LP side
    // ---------------------------------------------------------------------

    function deposit(uint256 periodId, uint256 amount) external nonReentrant {
        Period storage period = _periods[periodId];
        require(period.saleEnd != 0, "no such period");
        require(block.timestamp < period.saleEnd, "sale closed");
        // Once the first policy has been sold, premiums are already sitting
        // in the pool. Shares are still minted 1:1, so a deposit after that
        // point would buy a pro-rata cut of gains it didn't underwrite --
        // free-riding on earlier LPs. Closing deposits here keeps every
        // depositor's shares priced against the same pool state (deposits
        // only, no premiums yet), which is what makes 1:1 minting fair.
        require(period.totalMaxLiability == 0, "underwriting already started");
        require(amount > 0, "zero amount");

        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // Shares are minted 1:1 with deposited USDT. Pre-underwriting the
        // pool never loses principal and holds no premiums yet, so a
        // constant share price is safe.
        lpShares[periodId][msg.sender] += amount;
        period.totalShares += amount;
        period.totalCollateral += amount;

        emit Deposited(periodId, msg.sender, amount, amount);
    }

    /// @notice Parks the period's unsold capacity in the configured ERC-4626
    ///         vault so LP capital earns a base rate on top of the
    ///         underwriting premium. Permissionless: the risk it can take is
    ///         fully bounded by the owner's `vault` and `investBps`, so a
    ///         caller only ever chooses the timing.
    function investIdle(uint256 periodId) external nonReentrant returns (uint256 assets, uint256 shares) {
        Period storage period = _periods[periodId];
        require(period.saleEnd != 0, "no such period");
        IERC4626 v = vault;
        require(address(v) != address(0), "no vault");

        // The invest window opens at `saleEnd` and closes at settlement, and
        // both ends are load-bearing. `deposit` and `buyPolicy` each require
        // `block.timestamp < saleEnd`, so past that instant
        // `totalCollateral`, `totalPremiums` and `totalMaxLiability` are all
        // frozen and the `idle` figure below can never be invalidated by a
        // later call -- which is precisely why `buyPolicy` needs no changes
        // and never has to de-invest. Investing earlier would let a buyer
        // arriving afterwards push `totalMaxLiability` above the USDT still
        // physically in the pool.
        require(block.timestamp >= period.saleEnd, "sale still open");
        require(!period.settled, "already settled");

        // Single-shot per period, deliberately. A repeatable invest paired
        // with the repeatable `divest` below would let anyone grind the pool
        // down a couple of wei at a time: ERC-4626 rounds shares down on
        // deposit and assets down on redeem, so every round trip is a small
        // permanent loss borne by LPs. One-way per period removes the loop.
        require(period.vaultPrincipal == 0, "already invested");

        // Only capacity that nobody bought. Every `claim` pays at most that
        // policy's own `maxPayout` and those sum to `totalMaxLiability`, so
        // leaving that untouched here is exactly what keeps the vault out of
        // the claim path: `claim` is always payable from USDT physically held
        // by this contract, whatever the vault is doing. Computed from
        // period-local accounting and NOT from `usdt.balanceOf(address(this))`
        // -- this contract holds every period's USDT in one balance, so a
        // balance-derived figure would cheerfully invest another period's
        // collateral.
        uint256 idle = period.totalCollateral + period.totalPremiums - period.totalMaxLiability;
        assets = (idle * investBps) / BPS_DENOM;
        require(assets > 0, "nothing to invest");

        // Effects before the external calls. `vaultPrincipal` doubles as the
        // flag the "already invested" guard reads, so a vault that re-enters
        // this function is rejected on state, not only by `nonReentrant`.
        period.vaultUsed = address(v);
        period.vaultPrincipal = assets;

        // Exact amount, never `type(uint256).max`. Morpho vaults are
        // role-controlled and their implementation can change under us; a
        // standing max allowance would expose the buyers' liquid residual --
        // the one thing this whole design exists to protect -- to a future
        // version of someone else's contract. `deposit` consumes it entirely.
        usdt.forceApprove(address(v), assets);

        // `maxDeposit` is deliberately never consulted: Morpho Vaults V2
        // hardcodes it, and maxMint/maxWithdraw/maxRedeem, to 0, so gating on
        // it would disable this path against exactly the vaults this
        // integration targets.
        uint256 sharesBefore = v.balanceOf(address(this));
        v.deposit(assets, address(this));
        // Measured as a balance delta rather than read off `deposit`'s return
        // value: this contract holds one pooled share balance across every
        // period using the same vault, so a vault that over-reports would let
        // this period lay claim to another period's shares.
        shares = v.balanceOf(address(this)) - sharesBefore;
        // Zero shares for a non-zero deposit is the classic ERC-4626 inflation
        // attack -- someone donates into a near-empty vault so our deposit
        // rounds to nothing. Reverting keeps the USDT rather than booking
        // principal against shares we do not hold.
        require(shares > 0, "no vault shares");

        period.vaultShares = shares;

        emit Invested(periodId, address(v), assets, shares);
    }

    /// @notice Redeems some or all of a period's vault position back into this
    ///         contract. Permissionless, partial, and retryable.
    /// @dev Deliberately NOT called from `postSettlement`. A curated vault's
    ///      instantly-redeemable liquidity is routinely a fraction of its
    ///      deposits, and a `redeem` that reverted inside `postSettlement`
    ///      would stop the claim window from ever opening -- turning a
    ///      temporary liquidity crunch on someone else's contract into buyers
    ///      permanently losing a payout they had already earned. Kept
    ///      separate, the worst a stuck vault can do is delay LP withdrawal.
    function divest(uint256 periodId, uint256 shares) external nonReentrant returns (uint256 assets) {
        Period storage period = _periods[periodId];
        require(period.vaultShares > 0, "nothing invested");
        require(shares > 0, "zero shares");
        // Partial by design: callers size each redeem to whatever the vault
        // can actually service right now and come back for the rest.
        // `maxRedeem` is never consulted -- Vaults V2 returns 0 from it.
        require(shares <= period.vaultShares, "too many shares");

        IERC4626 v = IERC4626(period.vaultUsed);

        // Effect first: the share count this period may still redeem is
        // decremented before the external call, so a re-entering vault can
        // never redeem the same shares twice.
        period.vaultShares -= shares;

        uint256 balBefore = usdt.balanceOf(address(this));
        v.redeem(shares, address(this), address(this));
        // Balance delta, not `redeem`'s return value. ERC-4626 carries no
        // slippage guarantee and explicitly permits `redeem` to disagree with
        // `previewRedeem`; a vault that over-reported would inflate
        // `withdraw`'s `remaining` above what this contract holds and make the
        // last LP out revert on insufficient balance.
        assets = usdt.balanceOf(address(this)) - balBefore;

        period.vaultProceeds += assets;

        emit Divested(periodId, address(v), shares, assets);
    }

    function withdraw(uint256 periodId) external nonReentrant {
        Period storage period = _periods[periodId];
        require(period.settled, "not settled");
        // Strictly greater than, not >=: `claim` allows block.timestamp <=
        // claimDeadline, so at t == claimDeadline both functions would
        // otherwise be callable in the same block. An LP withdrawing first
        // would compute `remaining` against an outstanding unclaimed policy
        // and drain funds the buyer is still entitled to, making their
        // claim() revert on insufficient balance. This one-second gap
        // guarantees claim() always gets first access to the pool.
        require(block.timestamp > period.claimDeadline, "claim window open");
        // Every LP is paid a pro-rata slice of one `remaining` figure, so that
        // figure has to be final before the first LP is paid. While shares are
        // still in the vault, `vaultProceeds` is still moving: an LP
        // withdrawing now would be measured against a smaller pool than one
        // withdrawing after the next `divest`, and the last LP out would find
        // the arithmetic no longer matches the balance. `divest` is
        // permissionless and retryable, so anyone standing here -- including
        // this caller -- can unblock it without waiting on the operator.
        require(period.vaultShares == 0, "vault not divested");
        require(!lpWithdrawn[periodId][msg.sender], "already withdrawn");

        uint256 shares = lpShares[periodId][msg.sender];
        require(shares > 0, "no lp position");

        lpWithdrawn[periodId][msg.sender] = true;

        // Vault P&L folds straight into the pro-rata pot: proceeds credit it,
        // principal debits it. A vault loss therefore lands on LPs, which is
        // the correct asymmetry -- LPs are the only party that earns the
        // yield, and buyer payouts never entered the vault in the first place.
        // Grouped so each side is summed before the subtraction, and it can
        // never underflow: `vaultPrincipal <= totalCollateral + totalPremiums
        // - totalMaxLiability` at invest time and `totalClaimed <=
        // totalMaxLiability` always, so `vaultPrincipal + totalClaimed <=
        // totalCollateral + totalPremiums` unconditionally.
        uint256 remaining = (period.totalCollateral + period.totalPremiums + period.vaultProceeds)
            - (period.vaultPrincipal + period.totalClaimed);
        uint256 amount = (remaining * shares) / period.totalShares;

        usdt.safeTransfer(msg.sender, amount);

        emit Withdrawn(periodId, msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Buyer side
    // ---------------------------------------------------------------------

    /// @notice Fair-value quote for a policy: integrates the period's CPI
    ///         histogram to compute `E[max(min(CPI, cap) - strike, 0)]`, then
    ///         applies the period's load factor. Single source of truth for
    ///         both `buyPolicy` and the frontend preview -- never recompute
    ///         this independently client-side.
    function quote(uint256 periodId, uint256 notional, uint256 strikeBps)
        public
        view
        returns (uint256 premium, uint256 maxPayout)
    {
        Period storage period = _periods[periodId];
        require(period.saleEnd != 0, "no such period");
        require(strikeBps < period.capBps, "strike >= cap");
        require(notional > 0, "zero notional");

        maxPayout = (notional * (period.capBps - strikeBps)) / BPS_DENOM;

        // ev accumulates prob(bps) * excess(bps), i.e. scale 1e4 * 1e4 = 1e8.
        uint256 ev;
        uint256 n = period.cpiBucketsBps.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 excess = _clampedExcess(period.cpiBucketsBps[i], strikeBps, period.capBps);
            if (excess == 0) continue;
            ev += period.probBps[i] * excess;
        }

        // premium = notional * (ev / 1e4) / 1e4 [raw EV] * loadBps / 1e4 [load]
        //         = notional * ev * loadBps / 1e12
        premium = (notional * ev * period.loadBps) / 1e12;

        require(premium < maxPayout, "unpriceable: premium >= maxPayout");
    }

    function buyPolicy(uint256 periodId, uint256 notional, uint256 strikeBps)
        external
        nonReentrant
        returns (uint256 policyId)
    {
        Period storage period = _periods[periodId];
        require(block.timestamp < period.saleEnd, "sale closed");

        (uint256 premium, uint256 maxPayout) = quote(periodId, notional, strikeBps);

        // Solvency check runs against totalPremiums BEFORE this policy's own
        // premium is added below, so a policy's own premium can never count
        // toward backing its own liability.
        require(
            period.totalMaxLiability + maxPayout <= period.totalCollateral + period.totalPremiums,
            "insufficient pool backing"
        );

        usdt.safeTransferFrom(msg.sender, address(this), premium);

        period.totalPremiums += premium;
        period.totalMaxLiability += maxPayout;

        policyId = policyCount++;
        _policies[policyId] = Policy({
            periodId: periodId,
            owner: msg.sender,
            notional: notional,
            strikeBps: strikeBps,
            maxPayout: maxPayout,
            premiumPaid: premium,
            claimed: false
        });
        _policiesOf[msg.sender].push(policyId);

        emit PolicyBought(policyId, periodId, msg.sender, notional, strikeBps, premium, maxPayout);
    }

    function claim(uint256 policyId) external nonReentrant {
        Policy storage policy = _policies[policyId];
        require(policy.owner == msg.sender, "not policy owner");
        require(!policy.claimed, "already claimed");

        Period storage period = _periods[policy.periodId];
        require(period.settled, "not settled");
        require(block.timestamp <= period.claimDeadline, "claim window closed");

        policy.claimed = true;

        uint256 excess = _clampedExcess(period.settlementCpiBps, policy.strikeBps, period.capBps);
        uint256 payout = (policy.notional * excess) / BPS_DENOM;

        period.totalClaimed += payout;

        if (payout > 0) {
            usdt.safeTransfer(msg.sender, payout);
        }

        emit Claimed(policyId, msg.sender, payout);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function listPeriods() external view returns (Period[] memory all) {
        all = new Period[](periodCount);
        for (uint256 i = 0; i < periodCount; i++) {
            all[i] = _periods[i];
        }
    }

    function getPeriod(uint256 periodId) external view returns (Period memory) {
        return _periods[periodId];
    }

    function getPoliciesOf(address who) external view returns (uint256[] memory) {
        return _policiesOf[who];
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    function lpPosition(uint256 periodId, address lp) external view returns (uint256 shares, uint256 shareOfPoolBps) {
        shares = lpShares[periodId][lp];
        uint256 totalShares = _periods[periodId].totalShares;
        shareOfPoolBps = totalShares == 0 ? 0 : (shares * BPS_DENOM) / totalShares;
    }

    /// @notice What this period's vault position is worth right now, in USDT.
    ///         Zero once fully divested, or if the vault refuses to quote.
    /// @dev Reads `previewRedeem`, never `maxWithdraw`/`maxRedeem`: Morpho
    ///      Vaults V2 deliberately returns 0 from every `max*` function, so an
    ///      integration gating on those would silently read an empty position.
    ///      Wrapped in try/catch because a V2 curator can install a
    ///      `sendAssetsGate` that makes redemption previews revert for a
    ///      blocked holder. A view that propagated that revert would take the
    ///      LP page's whole batched read down with it -- every unrelated stat
    ///      on the panel would render as "-". Reporting 0 keeps the page
    ///      alive, and `Period.vaultShares` next to it is what distinguishes
    ///      "nothing invested" from "cannot currently price the position".
    function vaultValue(uint256 periodId) external view returns (uint256 assets) {
        Period storage period = _periods[periodId];
        if (period.vaultShares == 0) return 0;
        try IERC4626(period.vaultUsed).previewRedeem(period.vaultShares) returns (uint256 a) {
            assets = a;
        } catch {
            assets = 0;
        }
    }

    /// @notice What `investIdle` would deploy for this period right now, so
    ///         the UI can show the number before anyone signs for it.
    function idleCapacity(uint256 periodId) external view returns (uint256 assets) {
        Period storage period = _periods[periodId];
        if (period.vaultPrincipal != 0) return 0;
        uint256 idle = period.totalCollateral + period.totalPremiums - period.totalMaxLiability;
        assets = (idle * investBps) / BPS_DENOM;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev min(cpiBps, capBps) - strikeBps, floored at 0. Shared by `quote`'s
    ///      EV integration and `claim`'s actual payout, so pricing and
    ///      settlement always agree on the same payoff shape.
    function _clampedExcess(uint256 cpiBps, uint256 strikeBps, uint256 capBps) internal pure returns (uint256) {
        uint256 c = cpiBps > capBps ? capBps : cpiBps;
        if (c <= strikeBps) return 0;
        return c - strikeBps;
    }
}
