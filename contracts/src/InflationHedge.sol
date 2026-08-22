// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
/// @dev V1 trust model: CPI settlement is posted by a single trusted owner
///      address (`postSettlement`). No decentralized oracle. See
///      `IInflationOracle` for the V2 seam this would plug into (INDEC ->
///      resolver -> this contract), and the README for the full roadmap
///      (factory-per-pool, market-derived pricing, ERC721 policies).
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

    constructor(IERC20 usdt_) Ownable(msg.sender) {
        usdt = usdt_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

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
        require(!lpWithdrawn[periodId][msg.sender], "already withdrawn");

        uint256 shares = lpShares[periodId][msg.sender];
        require(shares > 0, "no lp position");

        lpWithdrawn[periodId][msg.sender] = true;

        uint256 remaining = period.totalCollateral + period.totalPremiums - period.totalClaimed;
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
