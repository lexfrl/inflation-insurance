import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Providers } from "./providers";
import { Sidebar, MobileNav } from "./sidebar";
import { Topbar } from "./topbar";
import { Ticker } from "./ticker";
import { Wordmark } from "@/components/logo";
import { DevWalletPanel } from "./dev-wallet-panel";

/* Licensed webfonts, see src/app/fonts/README.md. Only the Regular weight of
   each is licensed, so both declare a single 400: telling the browser the
   face answers for one weight stops it synthesising a fake bold. Weight
   contrast comes from size and colour instead. */
const ui = localFont({
  src: [
    { path: "./fonts/KernStandard-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/KernStandard-Regular.woff", weight: "400", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Helvetica", "Arial", "sans-serif"],
});

/* Every number in the product: prices, percentages, countdowns, payouts. They
   are read as columns, so they get a monospace with true tabular figures. */
const numeric = localFont({
  src: [
    { path: "./fonts/KHTekaMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/KHTekaMono-Regular.woff", weight: "400", style: "normal" },
  ],
  variable: "--font-numeric",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

/* The Figma macket is set in Inter, and its hierarchy is carried by weight:
   names and values at 600, chips at 500, tickers at 400. The two licensed kits
   below only license their Regular cut (see fonts/README.md), so that
   hierarchy is literally unreachable with them -- which is why the reference
   blocks read flat before this. Inter is SIL OFL, so loading the macket's own
   face is both the faithful and the legally clean option, and it removes any
   need for a synthesised bold. */
const figma = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figma",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hedgy",
  description:
    "Self-custodial inflation protection, settled in USDT against official CPI. Pick what you spend, pick the inflation level you want covered.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${numeric.variable} ${figma.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-page text-text">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <MobileNav />
              {/* The macket centres a 1440 column inside the area left of the
                  rail and starts it 24 below the top bar; the ticker is the
                  first row of that column, not a full-bleed band. */}
              <div className="mx-auto w-full max-w-shell flex-1 px-6 pt-6 xl:px-0">
                <Ticker />
                <DevWalletPanel />
                <main className="w-full">{children}</main>
              </div>
              {/* A real footer rather than two loose disclaimer lines: the
                  brand and what the product does, the routes that actually
                  exist, and then the legal/demo meta on its own rule. */}
              <footer className="mt-16 border-t border-line bg-page">
                <div className="mx-auto max-w-shell px-6 py-10 xl:px-0">
                  <div className="flex flex-col gap-8 md:flex-row md:justify-between">
                    <div className="max-w-[320px]">
                      <Wordmark />
                      <p className="mt-3 text-[13px] leading-5 text-muted">
                        Inflation cover you buy in USDT and settle on-chain against the official
                        figure for the period. No custodian, no claim to file.
                      </p>
                    </div>

                    <div className="flex gap-12">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">
                          Product
                        </p>
                        <ul className="mt-3 flex flex-col gap-2 text-[13px]">
                          <li>
                            <Link href="/" className="text-muted transition-colors hover:text-ink">
                              How it works
                            </Link>
                          </li>
                          <li>
                            <Link href="/protect" className="text-muted transition-colors hover:text-ink">
                              Buy cover
                            </Link>
                          </li>
                          <li>
                            <Link href="/earn" className="text-muted transition-colors hover:text-ink">
                              Earn
                            </Link>
                          </li>
                        </ul>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim">
                          Account
                        </p>
                        <ul className="mt-3 flex flex-col gap-2 text-[13px]">
                          <li>
                            <Link href="/profile" className="text-muted transition-colors hover:text-ink">
                              Dashboard
                            </Link>
                          </li>
                          <li>
                            <Link href="/admin" className="text-muted transition-colors hover:text-ink">
                              Operator
                            </Link>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-[12px] leading-5 text-dim md:flex-row md:items-center md:justify-between">
                    <span>
                      Payouts settle against the official inflation figure for the period, in USDT,
                      on-chain.
                    </span>
                    <span className="shrink-0">
                      Demo build, Aleph Hackathon. Periods and CPI values are operator-posted.
                    </span>
                  </div>
                </div>
              </footer>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
