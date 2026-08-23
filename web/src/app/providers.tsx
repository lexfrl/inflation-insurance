"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* `darkTheme()` with no arguments ships RainbowKit's own blue accent,
            and without `locale` the modal follows the browser's language --
            which is why the button came out blue and in the wrong language.
            Both are pinned here so the wallet flow matches the product. */}
        <RainbowKitProvider
          locale="en-US"
          theme={darkTheme({
            accentColor: "#ffc34c",
            accentColorForeground: "#1a1206",
            borderRadius: "medium",
            fontStack: "system",
            overlayBlur: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
