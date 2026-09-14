/**
 * Where a funding-safety row links, in-family. Shared by the mint panel and the
 * compact UTXO picker so the two surfaces build the same URLs.
 *
 * Both point at ordpool.space's tx-detail page with `?artifact=<identifier>`,
 * which ordpool reads to open the exact artifact: a tx can carry several, and
 * the tx page shows one at a time. An unrecognised param degrades to the first
 * artifact (never a not-found), so the link is a valid tx link before that
 * reader ships and auto-selects the right one after.
 *
 * Pure functions; candidates to move into `ordpool-sdk` alongside the other
 * funding-row helpers when that panel logic is opened up there (the
 * inscription-id split already exists in three copies across the family).
 */
const TX_BASE = 'https://ordpool.space/tx/';

/**
 * An inscription found on a coin, linked to the transaction that created it.
 * The txid is the id's prefix before the `iN` index; txids are hex and never
 * contain an `i`, so the split is unambiguous. The full id is the `artifact`.
 */
export function inscriptionReviewLink(inscriptionId: string): string {
  return `${TX_BASE}${inscriptionId.split('i')[0]}?artifact=${inscriptionId}`;
}

/**
 * A rune, linked to its etching transaction. ordpool's reader matches the rune
 * name spacer- and case-insensitively, so the name is passed as `artifact`
 * (URL-encoded — a rune name carries the `•` U+2022 spacer).
 */
export function runeEtchingReviewLink(etchingTxid: string, runeName: string): string {
  return `${TX_BASE}${etchingTxid}?artifact=${encodeURIComponent(runeName)}`;
}
