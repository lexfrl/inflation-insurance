import { Intro } from "@/components/intro";
import { PayoffChart } from "@/components/payoff-chart";
import { GetStarted } from "@/components/get-started";

/* The landing. Deliberately reads and writes nothing on-chain: someone with
   no wallet, on the wrong network, or with the RPC down still gets the whole
   explanation. The chart below is an illustration with fixed numbers for the
   same reason -- the live one lives on /protect, driven by the contract. */

const DEMO = {
  capBps: 800,
  strikeBps: 300,
  notional: 1000,
  buckets: [200, 400, 600, 800],
  probs: [4000, 3000, 2000, 1000],
};

export default function LandingPage() {
  return (
    <div className="flex flex-col gap-16">
      <section
        className="relative overflow-hidden rounded-card px-6 py-14 text-center sm:px-10 sm:py-20"
        style={{ background: "var(--gradient-hero)" }}
      >
        <h1 className="mx-auto max-w-[18ch] text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:text-5xl">
          When prices jump, you get paid
        </h1>
        <p className="mx-auto mt-5 max-w-[54ch] text-[15px] leading-relaxed text-white/80 sm:text-base">
          Cover what you spend each month. If inflation rises past the level you pick, the
          difference lands in your wallet in USDT.
        </p>
        <div className="mt-8 flex justify-center">
          <GetStarted />
        </div>
      </section>

      <Intro />

      <section className="flex flex-col gap-6 border-t border-surface-700 pt-12">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-content-100">
            The payout grows with the damage
          </h2>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-content-300">
            A prediction market on inflation pays the same whether prices rise 3.01% or 12%. It
            answers &ldquo;did it happen&rdquo;. That is a fine bet and a poor hedge, because your grocery
            bill keeps climbing after the threshold and the payout does not.
          </p>
          <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-content-300">
            Here the payout tracks how far past your level inflation actually went, up to a
            ceiling. Covering 1,000 above 3% pays nothing at 3%, 30 at 6%, and 50 from 8% up.
          </p>
        </div>

        <div className="rounded-card border border-surface-700 bg-surface-850 p-5">
          <PayoffChart
            capBps={DEMO.capBps}
            strikeBps={DEMO.strikeBps}
            notional={DEMO.notional}
            buckets={DEMO.buckets}
            probs={DEMO.probs}
          />
        </div>
      </section>

      <section className="border-t border-surface-700 pt-12">
        <h2 className="text-2xl font-semibold tracking-tight text-content-100">Who this is for</h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded-card border border-surface-700 bg-surface-700 sm:grid-cols-2">
          <div className="bg-surface-850 p-5">
            <h3 className="text-sm font-semibold text-content-100">People with a monthly budget</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-500">
              Rent, food, transport. When the number at the till moves faster than your income,
              this pays the difference on the part you chose to cover.
            </p>
          </div>
          <div className="bg-surface-850 p-5">
            <h3 className="text-sm font-semibold text-content-100">Small businesses</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-500">
              The hedges large companies use need a broker account and a minimum size. Buying
              stock you do not need yet is not a hedge, it is a cash-flow problem. This works at
              any size, from a phone.
            </p>
          </div>
          <div className="bg-surface-850 p-5">
            <h3 className="text-sm font-semibold text-content-100">People holding stablecoins</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-500">
              Dollars protect you from the peso. They do not protect you from prices in dollars
              rising. This covers the second thing.
            </p>
          </div>
          <div className="bg-surface-850 p-5">
            <h3 className="text-sm font-semibold text-content-100">Anyone willing to be the insurer</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-500">
              The other side is open too. Put up USDT, take the premiums, pay out if inflation
              runs hot. Same contract, opposite seat.
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5 border-t border-surface-700 pt-12">
        <h2 className="text-2xl font-semibold tracking-tight text-content-100">
          Ready when you are
        </h2>
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-content-300">
          Connect a wallet and you have an account. Everything after that happens on-chain:
          the price you are quoted, the cover you hold, and the payout.
        </p>
        <GetStarted />
      </section>
    </div>
  );
}
