import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "./nav";
import { DevWalletPanel } from "./dev-wallet-panel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ink-900 text-paper-100">
        <Providers>
          <Nav />
          <DevWalletPanel />
          <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 sm:py-14">{children}</main>
          <footer className="border-t border-ink-800 px-6 py-6">
            <div className="mx-auto flex max-w-4xl flex-col gap-1 text-xs text-paper-600">
              <span>
                Payouts settle against the official CPI print for the period, in USDT, on-chain.
              </span>
              <span>
                Demo deployment built at Aleph Hackathon. Periods and CPI values are operator-posted.
              </span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
