import { CatOutpoint } from 'ordpool-sdk';

/**
 * Parse a `?catTxid=<64hex>&catVout=<n>` URL intent-lock into a CatOutpoint.
 * Returns null when either param is missing or malformed (a txid that is not
 * 64 hex chars, a vout that is not a non-negative integer), so a legacy or
 * hand-edited link gets no stale check rather than a wrong one. The txid is
 * lower-cased so the result compares equal to the on-chain lookup regardless
 * of the link's casing.
 */
export function parseCatOutpointFromParams(
  txid: string | null | undefined,
  voutRaw: string | null | undefined,
): CatOutpoint | null {
  if (!txid || !voutRaw) return null;
  if (!/^[0-9a-f]{64}$/i.test(txid)) return null;
  const vout = Number.parseInt(voutRaw, 10);
  if (!Number.isInteger(vout) || vout < 0) return null;
  return { txid: txid.toLowerCase(), vout };
}
