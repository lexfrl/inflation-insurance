# contracts/

Foundry project for `InflationHedge`, the IPC Shield core contract. See the
[top-level README](../README.md) for the pitch, architecture, pricing model,
and run instructions.

Quick reference:

```
forge build
forge test -vvv
anvil &            # separate terminal
bash script/demo.sh

# Real Morpho on a Base mainnet fork. Skipped (loudly) without the env var,
# so plain `forge test` and CI never need an RPC endpoint.
BASE_RPC_URL=https://mainnet.base.org forge test --match-contract MorphoFork -vv
```
