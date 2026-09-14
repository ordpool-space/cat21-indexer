/**
 * The identity line for a rare sat found on a funding coin, rendered the way
 * the family's other sites render it: `<rarity> · sat <sat> · block <block>`.
 *
 * The sat NUMBER is the identity. Rarity and block alone do not name a sat:
 * two sats mined in the same block share both. The block is shown ungrouped to
 * match the explorer the row sits beside.
 *
 * Shared by the mint panel and the compact UTXO picker so the two surfaces
 * cannot drift. A pure, framework-agnostic function; a candidate to move into
 * `ordpool-sdk` alongside the other funding-row helpers when that panel logic
 * is opened up there.
 */
export function rareSatLabel(rare: { sat: string; block: number; rarity: string }): string {
  return `${rare.rarity} · sat ${rare.sat} · block ${rare.block}`;
}
