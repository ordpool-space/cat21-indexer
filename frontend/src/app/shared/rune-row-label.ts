import { formatRunePile } from 'ordpool-sdk';

/**
 * One rune's row text on the funding-safety panel: its balance rendered the way
 * ord renders it, then the name. Shared by the mint panel and the compact UTXO
 * picker so the two surfaces cannot drift.
 *
 * The value is typed `unknown` by the SDK because it is whatever ord put on the
 * `/output/` endpoint, so the shape is checked here rather than trusted. ord
 * serialises a pile's amount as a bare JSON NUMBER, so that is the case to
 * expect after `JSON.parse`; a string or a bigint is accepted too, for a value
 * that reached us some other way.
 *
 * Coerce an integer amount with `BigInt`, never `String`: `String(1e21)` is
 * `"1e+21"`, which `formatRunePile` rejects as not-base-units, so the amount
 * would vanish from the row with no error. Guard `Number.isInteger(n) && n >= 0`
 * first so `BigInt` cannot throw on a fraction, and wrap the call so a value
 * that cannot be read falls back to the bare name: a throw while someone is
 * deciding whether to spend a coin would take the whole panel down over a
 * cosmetic detail.
 *
 * Known bound, not a rule to engineer around: a rune amount is a u128, and one
 * above `Number.MAX_SAFE_INTEGER` has already lost its last digits inside
 * `JSON.parse`, before this runs. Nothing downstream can recover them, and for
 * a "would I mind burning this" panel it does not change the decision.
 */
export function runeRowLabel(name: string, value: unknown): string {
  if (typeof value !== 'object' || value === null) return name;
  const { amount, divisibility, symbol } = value as {
    amount?: unknown;
    divisibility?: unknown;
    symbol?: unknown;
  };

  const units =
    typeof amount === 'number' && Number.isInteger(amount) && amount >= 0
      ? BigInt(amount)
      : typeof amount === 'string' || typeof amount === 'bigint'
        ? amount
        : null;
  if (units === null || typeof divisibility !== 'number') return name;

  const sym = typeof symbol === 'string' || symbol === null ? symbol : undefined;
  try {
    return `${formatRunePile({ amount: units, divisibility, symbol: sym })} ${name}`;
  } catch {
    return name;
  }
}
