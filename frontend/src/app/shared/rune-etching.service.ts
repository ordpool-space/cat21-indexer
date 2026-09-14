import { Injectable, signal } from '@angular/core';
import { lookupRuneEtching } from 'ordpool-sdk';

import { environment } from '../../environments/environment';

/**
 * Rune name → the transaction that etched it, for the funding-safety panel's
 * rune rows. The scan names the runes on a coin but carries no txid, so each
 * name is resolved once against the full ord instance and remembered.
 *
 * The answers are a signal, so rows re-render as they arrive: a name is plain
 * text until its own lookup answers, and one slow name never holds up a panel
 * someone is reading to decide whether to spend a coin.
 *
 * Caching follows `lookupRuneEtching`'s four cases, which differ only in
 * whether the answer can change:
 *
 *   - `etched`     — permanent; remember the txid and link to it.
 *   - `not-etched` — permanent; a reserved rune (UNCOMMON•GOODS, the commonest
 *                    one on a coin) has no etching tx. Remember it as settled so
 *                    it renders plain text and is NEVER asked again.
 *   - `unknown`    — ord has no entry YET; the rune can be etched in a later
 *                    block, so do not settle it — a future scan re-asks.
 *   - `unavailable`— not an answer (timeout, outage); never remember it, retry.
 *
 * Remembering a `not-etched` is what takes the "re-ask UNCOMMON•GOODS on every
 * scan" cost to zero; remembering an `unavailable` would freeze one ord hiccup
 * into a row that stays unlinked for the life of the app, so neither of the two
 * non-permanent cases is kept.
 */
@Injectable({ providedIn: 'root' })
export class RuneEtchingService {
  /** Etched names only (name → txid). Read by the panels through {@link etchings}. */
  private readonly resolved = signal<ReadonlyMap<string, string>>(new Map());

  /** Names with a permanent answer (etched OR not-etched); never asked again. */
  private readonly settled = new Set<string>();

  /** Names with a lookup in flight, so a re-render does not start a second. */
  private readonly inFlight = new Set<string>();

  readonly etchings = this.resolved.asReadonly();

  /**
   * Look up every name not already settled or in flight. Runs them together
   * (a coin can carry several and they do not depend on each other), and is
   * safe to call on every scan: the settled + in-flight sets make it idempotent.
   */
  resolve(names: readonly string[]): void {
    const wanted = names.filter((n) => !this.settled.has(n) && !this.inFlight.has(n));
    if (wanted.length === 0) return;

    for (const name of wanted) this.inFlight.add(name);

    void Promise.all(
      wanted.map(async (name) => {
        // Never throws: the SDK maps every failure to a { kind } case.
        const result = await lookupRuneEtching(name, { ordBaseUrl: environment.ordFullExplorer });
        this.inFlight.delete(name);
        switch (result.kind) {
          case 'etched': {
            this.settled.add(name);
            const next = new Map(this.resolved());
            next.set(name, result.txid);
            this.resolved.set(next);
            return;
          }
          case 'not-etched':
            this.settled.add(name); // permanent, no link; never ask again
            return;
          case 'unknown':
          case 'unavailable':
            return; // not permanent: leave unsettled so a later scan retries
        }
      }),
    );
  }
}
