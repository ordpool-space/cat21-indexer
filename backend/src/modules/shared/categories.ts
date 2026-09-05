/**
 * CAT-21 rarity categories, re-exported from the single source of truth
 * in `ordpool-parser` (`src/cat21/cat21-category.ts`). The parser is the
 * foundation: `CATEGORY_RANGES`, `CATEGORIES` and `deriveCategory` are
 * defined there once and consumed everywhere, so a new band is added in
 * one place. The full narrative lives in
 * `ordpool-parser/CAT21-RARITY-SCORE.md`.
 *
 * `CATEGORY_RANGES` is `band → [minCatNumber, maxCatNumber inclusive,
 * dropSize]`, smallest-first. Each cat carries exactly one band, its
 * smallest applicable (cat #0 -> sub1, cat 500 -> sub1k, cat 5000 ->
 * sub10k). `deriveCategory` assigns it; the backend's sync derivation,
 * search validation, cache decisions and rarity recompute all read from
 * here. Only the DTO-validator alias below is backend-local.
 */
import { CATEGORIES } from 'ordpool-parser';

export { CATEGORY_RANGES, CATEGORIES, deriveCategory } from 'ordpool-parser';

/** Alias used by the DTO validator (csvOf wants `readonly string[]`). */
export const CATEGORY_VALUES = CATEGORIES;
