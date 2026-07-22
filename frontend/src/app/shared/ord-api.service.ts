import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { interval, map, Observable, shareReplay, startWith, switchMap } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * Cadence for the polled "what cats does this address currently own"
 * stream. Same 30s rhythm as the SDK's pendingMints$ + recommendedFees$
 * — slow enough not to hammer cat21-ord, fast enough that a tx mined
 * during the user's session surfaces without a manual reload.
 */
const ORD_ADDRESS_POLL_MS = 30_000;

export interface OrdCatInfo {
  address: string | null;
}

export interface OrdBlockResponse {
  ids: string[];
  cat_numbers: number[];
  more: boolean;
  page_index: number;
}

export interface OrdAddressResponse {
  outputs: string[];
  cats: string[];
  cat_numbers: number[];
  sat_balance: number;
}

// The subset of ord's /sat response we render. cat21.space shows only the
// cat-lore-relevant fields (which cats live here, who holds it, where it is
// now, whether the sat is special) — not ord's ordinal-theory position math
// (decimal/degree/percentile/cycle/epoch/period/offset) or its own sat rarity
// (which would collide with our cat-rarity score).
export interface OrdSatResponse {
  address: string | null;
  block: number;
  cat_numbers: number[];
  cats: string[];
  /** Special properties ord assigns to the sat (e.g. uncommon, palindrome, coin). */
  charms: string[];
  /** Base-26 sat name. */
  name: string;
  /** Current location `txid:vout:offset` — the UTXO holding this sat now, or null if ord has no location for it. */
  satpoint: string | null;
}

/**
 * ord's /sat response from the full ord instance (ordFullExplorer). We
 * only read `inscriptions` — the regular inscriptions living on the sat,
 * which the cat-only ord.cat21.space can't report.
 */
export interface OrdFullSatResponse {
  inscriptions: string[];
}

/**
 * Subset of ord's /inscription/<id> response we actually consume. The
 * `satpoint` field is the cat's current location encoded as
 * `txid:vout:offset` — that's the on-chain UTXO holding the cat right
 * now (not the mint outpoint).
 */
export interface OrdInscriptionResponse {
  id: string;
  number: number;
  address: string | null;
  /** `txid:vout:offset` — offset is always `0` for CAT-21 (FIFO). */
  satpoint: string;
  sat: number;
}

/**
 * Subset of ord's /output/<outpoint> response we consume. `script_pubkey`
 * is hex bytes; `cats` is the inscription IDs at this output.
 */
export interface OrdOutputResponse {
  outpoint: string;
  address: string | null;
  /** scriptPubKey of the output, raw hex bytes. */
  script_pubkey: string;
  cats: string[];
  sat_ranges: [number, number][];
}

/**
 * Direct client for ord.cat21.space — fetches live data
 * that is NOT stored in our backend (e.g., current owner).
 */
@Injectable({ providedIn: 'root' })
export class OrdApiService {
  private http = inject(HttpClient);

  getCurrentOwner(catNumber: number): Observable<string | null> {
    return this.http
      .get<OrdCatInfo>(`${environment.ordExplorer}/cat/${catNumber}`, {
        headers: { Accept: 'application/json' },
      })
      .pipe(map((info) => info.address));
  }

  getBlock(height: number, page = 0): Observable<OrdBlockResponse> {
    return this.http.get<OrdBlockResponse>(
      `${environment.ordExplorer}/inscriptions/block/${height}`,
      { headers: { Accept: 'application/json' }, params: page > 0 ? { page } : {} },
    );
  }

  getAddress(address: string): Observable<OrdAddressResponse> {
    return this.http.get<OrdAddressResponse>(
      `${environment.ordExplorer}/address/${address}`,
      { headers: { Accept: 'application/json' } },
    );
  }

  /**
   * Polled variant of `getAddress`. Re-fetches the address's confirmed
   * cats every 30s for as long as anyone is subscribed. Mirrors the
   * SDK's pendingMints$ rhythm so the cat21.space dashboard surfaces
   * a freshly-mined cat without the user reloading the page.
   *
   * Shared via `shareReplay({bufferSize:1, refCount:true})` so
   * multiple subscribers (wallet popover + /dashboard/cats gallery)
   * share one polling chain when both render the same address.
   */
  getAddressPolled(address: string): Observable<OrdAddressResponse> {
    return interval(ORD_ADDRESS_POLL_MS).pipe(
      startWith(0),
      switchMap(() => this.getAddress(address)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  getSat(sat: number): Observable<OrdSatResponse> {
    return this.http.get<OrdSatResponse>(
      `${environment.ordExplorer}/sat/${sat}`,
      { headers: { Accept: 'application/json' } },
    );
  }

  /**
   * Regular inscriptions living on a sat, from the full ord instance
   * (ord.cat21.space is cat-only and can't answer this). Returns the
   * inscription ids; the sat page renders each preview via
   * `${ordFullExplorer}/preview/<id>` inside a sandboxed iframe.
   */
  getSatInscriptions(sat: number): Observable<string[]> {
    return this.http
      .get<OrdFullSatResponse>(`${environment.ordFullExplorer}/sat/${sat}`, {
        headers: { Accept: 'application/json' },
      })
      .pipe(map((r) => r.inscriptions ?? []));
  }

  /**
   * Look up a CAT-21 inscription by its inscription ID
   * (format: `<mintTxid>i0`). Returns the cat's CURRENT location via
   * `satpoint = txid:vout:offset`, which is what the transfer +
   * accept-offer flows need (NOT the mint outpoint).
   */
  getInscription(inscriptionId: string): Observable<OrdInscriptionResponse> {
    return this.http.get<OrdInscriptionResponse>(
      `${environment.ordExplorer}/inscription/${inscriptionId}`,
      { headers: { Accept: 'application/json' } },
    );
  }

  /**
   * Look up an output by `txid:vout`. Returns scriptPubKey hex + the
   * inscriptions currently held at that output. The make-offer flow
   * uses this to auto-derive the seller's scriptPubKey without making
   * the user paste hex bytes by hand.
   */
  getOutput(outpoint: string): Observable<OrdOutputResponse> {
    return this.http.get<OrdOutputResponse>(
      `${environment.ordExplorer}/output/${outpoint}`,
      { headers: { Accept: 'application/json' } },
    );
  }

  /**
   * Return the sorted-ascending, deduped list of cat numbers riding
   * on a given UTXO. Wraps `getOutput` and normalises the ord
   * response's `cats` array (which we type as `string[]` for the
   * make-offer flow, but the values are numeric — ord returns cat
   * numbers as JSON numbers).
   *
   * Load-bearing for the v3 listings + bids flow: the seller signs
   * against this exact array, and the backend re-verifies against
   * its own live ord query. If the two drift, the backend rejects
   * with `cats-bundle-drift`.
   *
   * Returns `[]` for a UTXO with no cats (e.g. a plain BTC output
   * queried by mistake). Any HTTP error propagates — callers wrap
   * with `catchError` if they want a null fallback.
   */
  getCatsAtOutput(txid: string, vout: number): Observable<number[]> {
    return this.getOutput(`${txid}:${vout}`).pipe(
      map((out) => {
        const raw = (out?.cats ?? []) as unknown[];
        const nums = raw
          .map((c) => (typeof c === 'number' ? c : Number(c)))
          .filter((c) => Number.isInteger(c) && c >= 0);
        return Array.from(new Set(nums)).sort((a, b) => a - b);
      }),
    );
  }
}
