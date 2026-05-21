/**
 * Single source of truth for CAT-21 rarity categories.
 *
 * The spec lives in `ordpool-parser/CAT21-RARITY-SCORE.md`. Every
 * consumer in this codebase (sync derivation, search validation,
 * cache decisions, rarity recompute) reads from `CATEGORY_RANGES`
 * below — adding a new band means editing this file and nothing
 * else.
 *
 * Ranges are smallest-first; `deriveCategory` relies on insertion
 * order to assign each cat to its smallest applicable band.
 */

/**
 * band → [minCatNumber, maxCatNumber inclusive, dropSize].
 *
 * Bands are mutually exclusive collections, smallest-first. Each cat
 * carries exactly one — its smallest applicable (cat #0 → sub1, cat
 * 500 → sub1k, cat 5000 → sub10k). The dropSize is the closed
 * population: when a category's current row count equals dropSize,
 * the category is "closed" and its rarity ranks are frozen.
 *
 * `sub1` is the Genesis Cat's one-cat collection (cat #0 only) and
 * has been closed since the protocol's first mint. The `genesis`
 * boolean trait is a separate column — it fires for ~0.4% of cats
 * (the visual genesis-palette variant), not just cat #0. See
 * ordpool-parser/CAT21-RARITY-SCORE.md for the full narrative.
 */
export const CATEGORY_RANGES: Record<string, [number, number, number]> = {
  sub1:    [0,       0,       1],       // Genesis Cat only — closed since the protocol's first mint.
  sub1k:   [1,       999,     999],     // cats 1..999 (cat #0 lives in sub1)
  sub10k:  [1000,    9999,    9000],
  sub50k:  [10000,   49999,   40000],
  sub100k: [50000,   99999,   50000],
  sub250k: [100000,  249999,  150000],
  sub500k: [250000,  499999,  250000],
  sub1M:   [500000,  999999,  500000],
};

/** Ordered list of band names, smallest-first. Stable iteration order
 *  comes from ES2015+ string-keyed object insertion order. */
export const CATEGORIES: readonly string[] = Object.keys(CATEGORY_RANGES);

/** Alias used by the DTO validator (csvOf wants `readonly string[]`). */
export const CATEGORY_VALUES = CATEGORIES;

/**
 * Assign a cat to its smallest applicable band. Returns `''` for cats
 * outside every defined range (current spec stops at < 1 000 000).
 */
export function deriveCategory(catNumber: number): string {
  for (const [name, [, max]] of Object.entries(CATEGORY_RANGES)) {
    if (catNumber <= max) return name;
  }
  return '';
}
