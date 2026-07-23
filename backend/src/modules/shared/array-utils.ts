/**
 * Compare two `number[]`s as sets. Called with `cats_on_utxo` values
 * that both sides already claim are sorted-ascending-deduped, but a
 * malformed submission or an ord response drift could still trip a
 * false positive if we relied on element-wise equality alone.
 */
export function catsArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
