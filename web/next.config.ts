import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // wagmi/RainbowKit's Coinbase Smart Wallet ("Base") connector optionally
  // pulls in @coinbase/cdp-sdk, whose Solana/x402 payment code path resolves
  // packages (`@x402/svm/exact/client`, etc.) this app never installs since
  // it never uses that connector. Left as a normal dependency, the bundler
  // tries to statically resolve that whole graph at build time and fails;
  // marking it external defers resolution to runtime (Node's own
  // `require`/`import`), where it's simply never hit.
  serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
};

export default nextConfig;
