# web/

Next.js frontend for Inflation Insurance. See the
[top-level README](../README.md) for the pitch, architecture, and deployed
addresses.

```
pnpm install
cp .env.local.example .env.local   # fill in addresses (see top-level README)
pnpm dev
```

ABI is codegened from `../contracts/out` via `wagmi.config.ts` — run
`pnpm wagmi generate` after any contract change + `forge build`, never hand-edit
`src/lib/generated.ts`.
