/* The explanation layer.
 *
 * Before this existed the page opened straight onto a form full of words
 * nobody outside a derivatives desk uses -- strike, cap, notional, LP. A
 * judge or a first-time visitor had no way to work out what the product was,
 * let alone why they would want it. This says it in plain money terms first,
 * and only then hands over the controls.
 */
export function Intro() {
  return (
    <section className="flex flex-col gap-10">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight text-paper-100 sm:text-5xl">
            When prices jump,
            <br />
            you get paid.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-paper-300 sm:text-base">
            Cover what you spend each month. If inflation rises past the level you pick, the
            difference lands in your wallet in USDT.
          </p>
          <p className="mt-4 max-w-[52ch] text-sm leading-relaxed text-paper-500">
            This is insurance, not a bet. You are not guessing a number. You are covering the
            part of a price rise that comes out of your own pocket.
          </p>
        </div>

        {/* One worked example, in money, with no product vocabulary in it. */}
        <div className="rounded-card border border-ink-700 bg-ink-850 p-5">
          {/* These are the demo period's real numbers, not invented ones: a
              1,000 USDT cover above 3% on the 3%/8% period quotes at 16.80 and
              pays 30.00 if CPI lands at 6%. Verified against quote() on-chain
              and matching the worked example in the root README. */}
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-paper-600">
            For example
          </div>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-paper-300">You spend a month</dt>
              <dd className="font-mono text-paper-100 tnum">1,000 USDT</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-paper-300">You cover above</dt>
              <dd className="font-mono text-paper-100 tnum">3%</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-paper-300">It costs you</dt>
              <dd className="font-mono text-paper-100 tnum">16.80 USDT</dd>
            </div>
            <div className="my-1 border-t border-ink-700" />
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-paper-300">Inflation comes in at</dt>
              <dd className="font-mono text-paper-100 tnum">6%</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-medium text-paper-100">You receive</dt>
              <dd className="font-mono text-lg text-accent-400 tnum">30.00 USDT</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-paper-600">
            Had inflation stayed at 2%, you would receive nothing and be out the 16.80, the same
            way an unused insurance policy works.
          </p>
        </div>
      </div>

      {/* Grouped by rules and space rather than three identical boxes. */}
      <div className="grid gap-px overflow-hidden rounded-card border border-ink-700 bg-ink-700 sm:grid-cols-3">
        <Step
          title="Say what you spend"
          body="The amount you want protected for the period. Your payout scales with it."
        />
        <Step
          title="Pick your level"
          body="Inflation below it is normal and pays nothing. Above it is the part you are covering."
        />
        <Step
          title="Get paid automatically"
          body="When the official inflation figure is published, the contract pays out on-chain. No claim form, no company to chase."
        />
      </div>
    </section>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-ink-900 p-5">
      <h2 className="text-sm font-semibold text-paper-100">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-paper-500">{body}</p>
    </div>
  );
}
