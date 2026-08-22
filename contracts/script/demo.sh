#!/usr/bin/env bash
# Orchestrates the 3-phase Demo.s.sol lifecycle against local anvil, sleeping
# for real wall-clock time between phases (see Demo.s.sol for why this can't
# be a single vm.warp'd script). The same three `forge script --sig` calls
# work against Base Sepolia unmodified -- just point RPC_URL/PRIVATE_KEY at
# it and expect the sleeps to represent real waiting during a live demo.
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}" # anvil default account 0
SETTLE_CPI_BPS="${SETTLE_CPI_BPS:-500}" # 5.00% for the demo narrative

cd "$(dirname "$0")/.."

run() {
  forge script "$@" --rpc-url "$RPC_URL" --broadcast --private-key "$PRIVATE_KEY"
}

# Anvil only mines a new block when it receives a transaction -- it does not
# tick its chain forward in the background just because real time passes. So
# after sleeping past a deadline, force one empty block so the chain's own
# timestamp (which forge script's simulation reads from the latest block, not
# the host clock) actually reflects the elapsed real time. `cast rpc
# evm_mine` isn't a real endpoint on Base Sepolia -- `|| true` makes this a
# harmless no-op there, where real blocks are already advancing on their own.
mine_if_local() {
  cast rpc evm_mine --rpc-url "$RPC_URL" >/dev/null 2>&1 || true
}

echo "== Phase 1: deploy, create period, LP deposits, buyer buys a policy =="
OUT1=$(run script/Demo.s.sol --sig "deployAndOpen()")
echo "$OUT1"

USDT_ADDRESS=$(echo "$OUT1" | awk '/USDT_ADDRESS/ {print $2}')
INSURANCE_ADDRESS=$(echo "$OUT1" | awk '/INSURANCE_ADDRESS/ {print $2}')
PERIOD_ID=$(echo "$OUT1" | awk '/PERIOD_ID/ {print $2}')
POLICY_ID=$(echo "$OUT1" | awk '/POLICY_ID/ {print $2}')
PERIOD_END_UNIX=$(echo "$OUT1" | awk '/PERIOD_END_UNIX/ {print $2}')

echo "MockUSDT:        $USDT_ADDRESS"
echo "InflationHedge:  $INSURANCE_ADDRESS"
echo "Period / Policy ids: $PERIOD_ID / $POLICY_ID"

NOW=$(date +%s)
WAIT1=$(( PERIOD_END_UNIX - NOW + 2 ))
if [ "$WAIT1" -gt 0 ]; then
  echo "Waiting ${WAIT1}s for the CPI period to end..."
  sleep "$WAIT1"
fi
mine_if_local

echo "== Phase 2: owner posts CPI settlement, buyer claims =="
OUT2=$(run script/Demo.s.sol --sig "settle(address,uint256,uint256,uint256)" "$INSURANCE_ADDRESS" "$PERIOD_ID" "$POLICY_ID" "$SETTLE_CPI_BPS")
echo "$OUT2"

# claimDeadline is derived at settlement time (settledAt + claimWindowSecs),
# not known until phase 2 actually runs -- see Demo.s.sol.
CLAIM_DEADLINE_UNIX=$(echo "$OUT2" | awk '/CLAIM_DEADLINE_UNIX/ {print $2}')

NOW=$(date +%s)
WAIT2=$(( CLAIM_DEADLINE_UNIX - NOW + 2 ))
if [ "$WAIT2" -gt 0 ]; then
  echo "Waiting ${WAIT2}s for the claim window to close..."
  sleep "$WAIT2"
fi
mine_if_local

echo "== Phase 3: LP withdraws its share of the pool =="
OUT3=$(run script/Demo.s.sol --sig "withdrawPhase(address,uint256)" "$INSURANCE_ADDRESS" "$PERIOD_ID")
echo "$OUT3"

echo "== Demo complete =="
