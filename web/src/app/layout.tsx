import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar, MobileNav } from "./sidebar";
import { Topbar } from "./topbar";
import { Ticker } from "./ticker";
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

export const metadata: Metadata = {
  title: "Hedgy",
  description:
    "Self-custodial inflation protection, settled in USDT against official CPI. Pick what you spend, pick the inflation level you want covered.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${numeric.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-surface-900 text-content-100">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <MobileNav />
              <Ticker />
              <DevWalletPanel />
              <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
              <footer className="border-t border-surface-700 px-5 py-6">
                <div className="mx-auto flex max-w-6xl flex-col gap-1 text-xs text-content-600">
                  <span>
                    Payouts settle against the official inflation figure for the period, in USDT,
                    on-chain.
                  </span>
                  <span>
                    Demo deployment built at Aleph Hackathon. Periods and CPI values are
                    operator-posted.
                  </span>
                </div>
              </footer>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
