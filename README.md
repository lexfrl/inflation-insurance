# IPC Shield

Built at **Aleph Hackathon — Buenos Aires, August 2026**.

**Repo:** https://github.com/lexfrl/inflation-insurance
**Live frontend:** https://inflation-insurance.vercel.app (auto-deploys on every push to `main`; contract addresses below are placeholders until the Base Sepolia deploy runs, so on-chain reads will show empty until then)

Self-custodial inflation protection for LATAM, settled in USDT against
official CPI data. You tell it how much monthly spending to protect and
above what inflation level; it tells you the cost today and the maximum
payout. No prediction-market jargon anywhere in the product.

> **Polymarket tells you how likely inflation is. We let you hedge how much
> inflation hurts you.**

## The idea, in one picture

A Polymarket-style binary market on "Will CPI exceed 3%?" pays a fixed $1 per
share whether CPI comes in at 3.01% or 12%. That's fine for a prediction
market — the question really is just "did it happen?" — but it's a bad hedge:
your real-world damage from inflation keeps growing past the threshold while
the payout doesn't.

This product pays out **proportionally to the shock**, capped:

```
strike = 3%, cap = 8%, notional = $1,000

CPI 2%   -> payout $0
CPI 3%   -> payout $0
CPI 4%   -> payout $10
CPI 5%   -> payout $20
CPI 6%   -> payout $30
CPI 8%+  -> payout $50   (capped)
```

`payout = notional × clamp(CPI − strike, 0, cap − strike)`

You could approximate this today by manually buying five separate CPI-tier
markets on Polymarket. We package that payoff into one product: choose your
expenses, choose your strike, buy protection. Prediction markets are the
primitive; this is the insurance product built on top of it.

## Four judging narratives, one product

| Track | Why it fits | What to show |
| --- | --- | --- |
| Crypto / DeFi | A real onchain derivative/hedge, priced and settled entirely onchain | buy → resolve → claim |
| RWA | Payout is keyed to an official real-world macro index, not a crypto price | INDEC IPC → oracle adapter → contract |
| Consumer App | A genuine derivative hidden behind a simple UX | "Protect $1,000 above 3%" |
| Tether | USDT is the settlement asset end to end, via a self-custodial WDK wallet flow | connect wallet → USDT balance → pay premium → claim payout |

And a fifth framing, for judges evaluating social impact: inflation is
effectively an unpredictable tax on households. Sophisticated investors have
derivatives to manage macro risk; ordinary consumers don't. IPC Shield makes
inflation protection accessible with a few dollars of USDT — turning a
financial instrument normally available to institutions into a consumer
financial-resilience product.

## How it's priced (the actual differentiator)

Polymarket prices one event: `P(CPI > 3%)`. This contract prices the whole
distribution — literally computing the expected value of the capped,
strike-shifted payoff:

```
Fair value = E[max(min(CPI, cap) − strike, 0)]
```

`InflationHedge.quote()` does this on-chain: each period stores a discrete
CPI histogram (`cpiBucketsBps` / `probBps`, operator-supplied from recent
INDEC prints), and the premium is that histogram's expected payout times a
load factor (`loadBps`, e.g. `12000` = 1.2× EV). The load factor exists
because at premium == EV exactly, LPs have zero expected return and no
reason to deposit — it's the risk premium LPs are paid to underwrite the
pool.

This is also the **single source of truth** for pricing: the frontend never
recomputes premium/payout in JavaScript, it only ever displays what
`quote()` returns on-chain.

## Architecture

Three roles share one pool per period — nobody but the buyer ever sees a
"share" or a "probability":

```mermaid
flowchart LR
    LP["LP<br/>liquidity provider"]
    BUYER["Buyer<br/>insured person"]
    OWNER["Owner<br/>trusted operator"]
    POOL(["InflationHedge<br/>one Period pool<br/>collateral + premiums, in USDT"])
    MORPHO(["Morpho vault<br/>ERC-4626 yield venue"])

    LP -- "deposit(usdt)<br/>shares minted 1:1, closes once<br/>underwriting starts" --> POOL
    POOL -- "withdraw()<br/>pro-rata share of what's left" --> LP

    BUYER -- "buyPolicy(notional, strikeBps)<br/>premium = quote()" --> POOL
    POOL -- "claim()<br/>payout = notional x clamp(CPI - strike, 0, cap - strike)" --> BUYER

    OWNER -- "postSettlement(cpiBps)<br/>once period ends, opens the<br/>claim window from that moment" --> POOL

    POOL -- "investIdle()<br/>unsold capacity only" --> MORPHO
    MORPHO -- "divest()<br/>permissionless, partial, retryable" --> POOL

    classDef role fill:#f6f6f6,stroke:#999,color:#111;
    classDef pool fill:#fdece2,stroke:#c74e1e,stroke-width:2px,color:#111;
    classDef venue fill:#e8f0fe,stroke:#3b6cb5,stroke-width:2px,color:#111;
    class LP,BUYER,OWNER role;
    class POOL pool;
    class MORPHO venue;
```

- **LP** funds the pool and takes the other side of the risk: deposits USDT
  pre-sale (only until the *first* policy is sold — see "LP fairness"
  below), withdraws principal + premiums − claims after the claim window
  closes.
- **Buyer** (the insured person) pays a premium for a policy and, if the
  settled CPI clears their strike, claims a payout capped at
  `notional × (cap − strike)`.
- **Owner** is the V1 trust root: creates each period's terms and histogram,
  then posts the single settled CPI value everything pays out against. No
  decentralized oracle yet (see "What's V1" below).

In code terms, that's one contract and a `periods` mapping:

```
InflationHedge.sol
├── Period (per CPI period, e.g. "Argentina CPI, Sep 2026")
│   ├── LPs deposit USDT -> shares, 1:1                    [deposit]
│   │     closes once the first policy is sold
│   ├── Buyers pay a premium for a Policy                  [buyPolicy]
│   │     Policy = { notional, strikeBps, maxPayout, ... }
│   ├── Owner posts the settled CPI once the period ends    [postSettlement]
│   │     derives claimDeadline = block.timestamp + claimWindowSecs
│   ├── Buyers claim their payout                           [claim]
│   └── LPs withdraw their pro-rata share of what's left     [withdraw]
```

No factory, no per-pool deployment.
`quote()` is a `view` function so both `buyPolicy` and the frontend call the
exact same pricing code.

**Solvency invariant**, enforced on every purchase:

```solidity
totalMaxLiability + thisPolicysMaxPayout <= totalCollateral + totalPremiums
```

checked using `totalPremiums` *before* this policy's own premium is added —
a policy's own premium can never count toward backing itself. This is the
only capacity check the contract needs; it's covered by unit tests at the
exact boundary, by 20,000-run fuzz tests, and by a stateful invariant suite
(`forge test --match-contract Invariant`).

**LP fairness**, enforced on every deposit:

```solidity
require(period.totalMaxLiability == 0, "underwriting already started");
```

Shares are minted 1:1 with deposited USDT, which is only fair while the pool
holds nothing but LP capital. Once the first policy is sold, premiums are
already sitting in the pool — a deposit after that point would buy a
pro-rata cut of gains it never underwrote. Closing deposits at the first
sale keeps every LP's shares priced against the same pool state.

**Claim window**, derived at settlement, not fixed at creation:

```solidity
period.claimDeadline = block.timestamp + period.claimWindowSecs; // set inside postSettlement
```

An earlier design stored `claimDeadline` as an absolute timestamp fixed when
the period was created. That meant a late settlement — posted after that
fixed deadline had already passed — could permanently lock buyers out of
`claim()` while `withdraw()` was immediately callable, letting LPs walk off
with premiums that should have paid out. Deriving the deadline from the
settlement call itself closes that gap: buyers always get a full
`claimWindowSecs` to claim, no matter how late settlement posts.

**Idle capital earns a base rate, and buyers' payouts never move:**

```solidity
vaultPrincipal <= totalCollateral + totalPremiums - totalMaxLiability
```

This exists because the pool had no answer for its first LP. On the worked
example below — $1,000 of collateral backing one $1,000-notional policy — the
LP's expected underwriting profit is `1.2 × EV − EV` = **$2.80, i.e. +0.28% for
the whole period**. Underwriting only pays properly at high utilization
(roughly +8% expected once ~29 such policies are sold), and a new pool never
starts there. Measured against real Morpho on Base mainnet, the same idle
capital earns **3.86% APY** (see the fork test below), which at low utilization
dominates the premium income outright. That turns the LP pitch from "lock
$1,000 for a month and earn 28 cents in expectation" into **base rate +
underwriting premium** — a proposition that works from the very first deposit.

The honest counterweight: yield is earned only on the *unsold* portion, so its
contribution shrinks as utilization rises. This fixes cold start, not steady
state.

Two design choices keep the yield venue away from anything a buyer depends on:

- **Only unsold capacity is ever deployed.** `totalMaxLiability` is subtracted
  before anything is sent to the vault, so the USDT physically held by this
  contract always covers every outstanding payout. A vault that is illiquid,
  gated, or insolvent can only cost LPs — never a policyholder. This is pinned
  by `invariant_liquidUsdtCoversOutstandingClaims` and, against production
  Morpho, by `test_ForkBase_InvestIdleLeavesBuyerLiabilityFullyLiquid`.
- **The invest window is `[saleEnd, settlement)`.** Both `deposit` and
  `buyPolicy` require `block.timestamp < saleEnd`, so past that instant
  collateral, premiums and liability are all frozen and the idle figure cannot
  go stale. That is why `buyPolicy` needed no changes and never has to
  de-invest.

`divest` is deliberately **not** called from `postSettlement`. A curated
vault's instantly-redeemable liquidity is routinely a fraction of its deposits,
and a `redeem` that reverted inside `postSettlement` would stop the claim
window from ever opening — turning a temporary liquidity crunch on someone
else's contract into buyers permanently losing a payout they had already
earned. Kept separate, partial, and retryable, the worst a stuck vault can do
is delay LP withdrawal. Both `investIdle` and `divest` are permissionless, so
no LP ever waits on the operator.

## Example: a buyer's walkthrough

Concrete numbers, taken straight from the test suite's founder's-example
fixture (`test_QuoteMatchesFounderExample`, `test_Claim_PaysCorrectAmount`) —
nothing here is rounded for the README. The diagram below is the full pool,
not just the buyer: it includes the LP who backs this period, and contrasts
today's trusted-owner settlement with the oracle-fed version from the "What's
V1" roadmap (that branch is illustrative — V1 ships only the owner path):

```mermaid
sequenceDiagram
    actor LP
    actor Buyer
    participant Pool as InflationHedge
    actor Owner
    participant Oracle as IInflationOracle (illustrative)

    LP->>Pool: deposit(periodId, 1000e6)
    Pool-->>LP: shares minted 1:1

    Buyer->>Pool: quote(periodId, 1000e6, 300)
    Pool-->>Buyer: premium 16.80 USDT, maxPayout 50.00 USDT

    Buyer->>Pool: approve USDT
    Buyer->>Pool: buyPolicy(periodId, 1000e6, 300)
    Note right of Buyer: only the 16.80 USDT premium moves —<br/>the $1,000 notional never leaves the buyer's wallet
    Pool-->>Buyer: Policy locked: notional $1,000, strike 3%, cap 8%

    Note over Pool: period ends

    alt Today (V1): trusted owner posts settlement
        Owner->>Pool: postSettlement(periodId, 500)
    else Suppose we had an oracle (V2, illustrative)
        Oracle->>Oracle: fetch settled CPI (e.g. Chainlink Functions from INDEC)
        Oracle->>Pool: postSettlement(periodId, 500)
    end
    Note over Pool: CPI settles at 5.00%<br/>claim window opens now

    Buyer->>Pool: claim(policyId)
    Pool-->>Buyer: payout 20.00 USDT

    Note over Pool: claim window closes

    LP->>Pool: withdraw(periodId)
    Pool-->>LP: 996.80 USDT (1,000 deposited + 16.80 premium − 20.00 claimed)
```

1. **Connect & pick a period.** The buyer connects a wallet and picks the
   open "Argentina CPI, Sep 2026" period, capped at 8%, priced off a
   histogram of `{2%, 4%, 6%, 8%}` at `{40%, 30%, 20%, 10%}`.
2. **Set spend & strike.** They want $1,000/month of spending protected
   above 3% inflation.
3. **Read the quote.** `quote(periodId, 1000e6, 300)` — called live, same
   code path the frontend and `buyPolicy` both use — returns:
   - `premium = 16.80 USDT`
   - `maxPayout = 50.00 USDT` (= $1,000 × (8% − 3%))
4. **Approve & buy.** One USDT approval, then `buyPolicy(periodId, 1000e6,
   300)` pays the 16.80 USDT premium and locks in a `Policy` with that
   notional, strike, and max payout. The buyer only ever sends the
   **premium** — the `1000e6` notional is a pricing input (how much spending
   to protect), not USDT the buyer transfers; the $1,000 of real collateral
   backing the payout comes from the LP's deposit, not the buyer.
5. **Wait for settlement.** The period ends; the owner calls
   `postSettlement(periodId, 500)` — CPI printed at 5.00%. This is also the
   moment the claim window opens: `claimDeadline = block.timestamp +
   claimWindowSecs`.
6. **Claim.** `claim(policyId)` pays out
   `min(5%, 8%) − 3% = 2%` of the $1,000 notional — **20.00 USDT** — turning
   a 16.80 USDT premium into a 20.00 USDT payout because the shock (5%)
   cleared the strike (3%).

Two outcomes worth naming explicitly:

- **CPI settles at or below 3%:** the policy pays out $0. The premium isn't
  refunded — exactly like a traditional insurance premium, it bought
  protection for the period, not a guaranteed return.
- **CPI settles at or above 8% (the cap):** payout is capped at $50, no
  matter how far above 8% the print lands — the same cap that keeps the
  pool's liability bounded and solvent.

Miss the claim deadline and the payout right simply lapses; LPs later
withdraw whatever's left in the pool, unclaimed payouts included.

## What's V1 (stated plainly, not hidden)

- **Trusted oracle.** CPI settlement is posted by a single owner address —
  there's no decentralized oracle. `IInflationOracle` (`resolved()` /
  `cpiBps()`) is defined as the V2 seam a resolver would implement — a
  signed INDEC attestor, UMA, GenLayer — but it's not wired into
  `postSettlement` today; swapping a real resolver in later never has to
  touch pricing or settlement math.
- **No settlement escape hatch.** If the owner never calls
  `postSettlement`, LP funds are locked in that period permanently — there's
  no timeout/refund path. This is a real cost of the V1 trust model, not an
  oversight.
- **Operator-supplied histogram.** The CPI probability distribution used for
  pricing is set once by the operator at period creation, not derived from a
  live market. V2: aggregate real prediction-market prices or a growing
  on-chain track record.
- **Yield venue is an owner-configured knob.** `vault` and `investBps` are set
  by the owner with no per-LP opt-out. Pointing the pool at a malicious or
  failing vault loses LP principal, up to `investBps` of unsold capacity. LP
  principal carries the venue's risk; buyers' payouts never do.
- **No divest escape hatch.** If a vault permanently blocks redemption,
  `withdraw()` stays blocked for that period — and the blast radius is the
  *whole* period, not just the invested slice, because every LP is paid one
  pro-rata slice of one final number. Same shape of cost as the settlement
  lock above, named rather than papered over with an owner-only write-off
  button.
- **Divest is a manual step.** Someone has to call `divest` before `withdraw`
  works. It is permissionless and retryable so any LP can do it themselves.
- **Yield is not in `quote()`.** Pricing is untouched; all vault yield accrues
  to LPs through the existing pro-rata `withdraw()`.
- **Morpho Vaults V2 is not on Base Sepolia.** Only Morpho Blue, the adaptive
  IRM and the MetaMorpho (Vaults V1) factory are deployed there — the V2
  factory address the docs list under Base Sepolia has no code on that chain.
  A freshly created MetaMorpho vault also derives `maxDeposit` from its
  enabled markets, so it accepts no deposits until the owner submits and
  accepts a market cap, which is timelocked at one day minimum. Hence the
  three-venue split described under "Running it".
- **No factory.** One contract holds all periods. V2:
  `InflationHedgeFactory` deploying minimal-proxy pools per period/operator.
- **Policies aren't tokenized.** A policy is a struct + owner mapping, not
  an ERC721. V2: make them transferable/tradeable.

**Deliberately not built**, even though some of it is "obvious DeFi": LP
positions as a Uniswap-style AMM/LMSR market, ERC-1155 YES/NO shares, a
secondary market for policies, cross-chain deployment, a governance token, a
DAO, liquidity mining. On the yield side specifically: auto-compounding across
periods, a protocol fee or LP/protocol split on yield, multiple vaults per
period, per-LP opt-out, and re-investing after a partial divest (single-shot
per period is what forecloses a rounding-grind loop against ERC-4626's floor
rounding). Every one of these trades demo reliability this close
to submission for surface area that doesn't move any of the judging
narratives above.

## Repo layout

```
contracts/          Foundry project
  src/InflationHedge.sol   core contract
  src/MockUSDT.sol         open-mint testnet USDT stand-in
  src/MockYieldVault.sol   testnet ERC-4626 vault; reproduces Vaults V2 quirks
  src/IInflationOracle.sol V2 oracle-adapter seam (unwired, documented only)
  test/                    60 tests: unit, fuzz (20k runs), stateful invariant
  test/InflationHedgeMorphoFork.t.sol  real Morpho on a Base mainnet fork
  script/Deploy.s.sol      deploys MockUSDT + InflationHedge + MockYieldVault
  script/DeployMorphoVault.s.sol  creates a real MetaMorpho vault (Base Sepolia)
  script/Demo.s.sol        3-phase real-broadcast lifecycle demo
  script/demo.sh           orchestrates the 3 phases with real wall-clock waits
web/               Next.js + wagmi/viem + RainbowKit frontend
  src/app/page.tsx       buyer flow (protect spending)
  src/app/lp/page.tsx    LP flow (provide liquidity)
  src/app/admin/page.tsx owner-only: create periods, post settlements
```

## Running it

### Contracts

```
cd contracts
forge build
forge test -vvv                                    # 60 tests, all green
forge test --match-contract Fuzz --fuzz-runs 20000  # pricing/solvency properties
forge test --match-contract Invariant -vvv          # stateful solvency fuzzing

# Real Morpho, real yield, on a Base mainnet fork. Skips loudly without the
# env var, so plain `forge test` (and CI) never needs an RPC.
BASE_RPC_URL=https://mainnet.base.org forge test --match-contract MorphoFork -vv
```

### Where the Morpho integration is real, and where it is a prop

| Venue | What it proves | What it does not |
| --- | --- | --- |
| Base mainnet fork test | Real deposits, share accounting and accrued interest in Gauntlet USDC Prime (`0xeE8F...4b61`), measured at **3.86% APY** over 30 days | It is a MetaMorpho **V1** vault, so it cannot prove the "never gate on `max*`" property |
| `MockYieldVault` (anvil) | The Vaults **V2** quirks: all four `max*` functions hardcoded to 0, plus deposit gating and thin liquidity | Not a yield source; accrual is simulated |
| Base Sepolia | A real MetaMorpho vault can be created over our own collateral | Vaults V2 is not deployed there, and a fresh vault takes no deposits until a market cap is accepted (1-day timelock) |

### Full lifecycle demo (local anvil, real broadcast transactions)

`vm.warp` cannot survive a real broadcast on any chain — Foundry validates
every script against a broadcast-equivalent replay that ignores it, anvil
included. So the demo is three real transactions driven by real elapsed
time, not one script with a time-travel cheatcode:

```
anvil &
cd contracts
bash script/demo.sh
```

Deploys fresh contracts, creates a period, deposits, buys a policy, waits for
the sale window to close, deploys the unsold capacity into the yield vault,
waits for the period to end, posts settlement (opening the claim window),
claims, unwinds the vault position, waits for the claim window to close, and
withdraws — printing the USDT balance change at each step.

A run on local anvil, end to end: 966.80 USDT of unsold capacity deployed,
25.00 of yield accrued, buyer paid 20.00, LP withdrew **1,021.80** = 1,000
principal + 16.80 premium + 25.00 yield − 20.00 claimed.

### Frontend

```
cd web
pnpm install
cp .env.local.example .env.local   # fill in addresses below (or your own deploy)
pnpm dev
```

The frontend reads its ABI directly from `contracts/out` via
`wagmi.config.ts` (`pnpm wagmi generate` after any contract change +
`forge build`) — it can't drift from what's actually deployed.

## Deployed addresses

`.env.local` is gitignored, so here's what a reviewer needs to plug in:

**Local anvil** (chain id `31337`, rpc `http://127.0.0.1:8545`) — the
values used during development, redeployed fresh by `forge script
script/Deploy.s.sol --broadcast` any time:

| Contract        | Address |
|------------------|---------|
| MockUSDT         | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| InflationHedge   | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| MockYieldVault   | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

**Base Sepolia** (chain id `84532`) — _pending a funded deployer key,
see below._ The live Vercel frontend currently points at placeholder
addresses (`0x0...dEaD`) on this chain until that deploy runs.

## CI/CD

- **`.github/workflows/ci.yml`** — every push/PR to `main`: `forge build`
  + `forge test` (unit, 10k-run fuzz, invariants) + `forge coverage`, and
  `pnpm lint` + `pnpm build` for the frontend.
- **`.github/workflows/deploy-frontend.yml`** — every push to `main`: builds
  and deploys the frontend to Vercel (https://inflation-insurance.vercel.app).
  Uses the Vercel CLI + an API token (`VERCEL_TOKEN`/`VERCEL_ORG_ID`/
  `VERCEL_PROJECT_ID` repo secrets) rather than Vercel's native GitHub App,
  since installing that app requires an interactive OAuth screen.
- **`.github/workflows/deploy-contracts.yml`** — **manual trigger only**
  (Actions tab → "Deploy contracts (Base Sepolia)" → Run workflow).
  Deliberately not on every push: a contract deploy always creates a new
  address, unlike a web app redeploy. Needs a `BASE_SEPOLIA_DEPLOYER_KEY`
  repo secret (add your own — generate with `cast wallet new` in your own
  terminal, fund it via a Base Sepolia faucet, then add it under Settings →
  Secrets and variables → Actions). After it runs, copy the printed
  addresses into the Vercel project's env vars and this README.

## Status / what's left

- [x] Contract, pricing, solvency + LP-fairness invariants, full test suite
- [x] USDT collateral end to end (contract, tests, deploy/demo scripts)
- [x] Derived claim window (settlement-time-based, not creation-time-fixed)
- [x] Frontend (buyer / LP / admin flows) verified against local anvil
- [x] GitHub repo, CI, and Vercel auto-deploy for the frontend
- [x] Idle LP liquidity deployed to an ERC-4626 (Morpho) vault, with the
      buyer-liquidity invariant and a real Base-mainnet fork test
- [ ] Base Sepolia deployment — blocked on a funded deployer key
- [ ] Real Tether WDK wallet integration (connect, balance, signed txs)
- [ ] Payoff curve + pricing/EV breakdown in the buyer UI
- [ ] Live demo video
- [ ] DoraHacks submission

Built with Foundry, Next.js, wagmi/viem, and RainbowKit.
