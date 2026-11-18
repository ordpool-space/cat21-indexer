import {
  AnnotatedFundingUtxo,
  FundingRecommendation,
  TxnOutput,
  UtxoAssetDetail,
  outpointKey,
} from 'ordpool-sdk';

/**
 * The asset detail a funding notice names: the assets of the coin that WILL be
 * spent (`resolvedFundingUtxo` — the person's pick while it covers, else the
 * SDK's recommendation), read back from the recommendation's `candidates` by
 * outpoint. The pick is always one of them (the SDK selects from `candidates`),
 * so the notice names what the action SPENDS, never the recommended coin after
 * an explicit override.
 *
 * Gated on the RECOMMENDATION's `asset-notice` status — the SDK had no clean
 * cover and resorted to an asset coin. That gate is what keeps this notice
 * distinct from the stronger `asset-found-warning` a person gets for
 * deliberately picking an asset coin when a clean one was available (there the
 * recommendation is not `asset-notice`, so this returns null and the page falls
 * through to the warning branch).
 *
 * Shared by mint, transfer and make-offer so "name the coin the action spends"
 * lives in one place instead of three.
 */
export function resolvedNoticeAssets(
  rec: FundingRecommendation<TxnOutput & AnnotatedFundingUtxo> | null | undefined,
  resolvedPick: { txid: string; vout: number } | null | undefined,
): UtxoAssetDetail | null {
  if (rec?.status !== 'asset-notice') return null;
  const pick = resolvedPick ?? rec.recommended;
  if (!pick) return null;
  const key = outpointKey(pick);
  const annotated = rec.candidates.find((c) => outpointKey(c) === key);
  return annotated?.assets ?? null;
}
