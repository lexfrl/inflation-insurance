/// `useWaitForTransactionReceipt` does NOT resolve successfully with a
/// `status: "reverted"` receipt for a reverted transaction -- confirmed
/// empirically (see `web/CLAUDE.md`-adjacent testing notes): viem re-checks
/// a mined-but-reverted tx via `eth_call` to recover the revert reason, and
/// surfaces that as a thrown `CallExecutionError`, so the query ends in
/// `isError: true` with `data` never populated. `isSuccess` never becomes
/// true for it. So revert detection has to check `isError`, not the
/// receipt's own `status` field, which is the obvious-looking place to look
/// but is never reached on this path -- checking it silently treats every
/// revert as success.
export function txReverted(receipt: { isError: boolean }): boolean {
  return receipt.isError;
}

/// viem's revert error message is long and includes the raw call args
/// ("Execution reverted with reason: insufficient pool backing. Raw Call
/// Arguments: from: 0x... to: 0x... data: 0x..."). Trim it down to the
/// useful sentence for display.
export function txErrorMessage(receipt: { error: { message: string } | null | undefined }): string | undefined {
  const msg = receipt.error?.message;
  if (!msg) return undefined;
  return msg.split(/\n|Raw Call Arguments:/)[0].trim();
}
