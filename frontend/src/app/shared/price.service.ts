import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';

import { environment } from '../../environments/environment';

interface PriceResponse {
  time?: number;
  USD?: number;
  EUR?: number;
}

/**
 * Current `sat -> USD` conversion, for the sat readouts that show a USD
 * equivalent (the mint price, asks, bids).
 *
 * Hits `<mempoolApiUrl>/api/v1/prices` (a mempool-fork endpoint served by our
 * own ordpool-backend at api.ordpool.space). The sats are the source of truth;
 * USD only floats a current figure beside them, so anything that would make
 * the rate untrustworthy collapses to `null` and the caller hides the suffix:
 *
 * - empty `mempoolApiUrl` (regtest) -> we never fetch,
 * - the backend's price-updater seeds `USD: -1` on cold start and can
 *   transiently return `0` / non-number values, and
 * - any network / parse error.
 *
 * A single formatter (`formatSatsWithUsd` in ordpool-sdk) turns the pair into
 * the string; this service only answers "what is one BTC worth in USD, or
 * null if we can't say".
 */
@Injectable({ providedIn: 'root' })
export class PriceService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.mempoolApiUrl;

  /**
   * The BTC/USD rate is near-static and read on many cat views, so fetch it
   * once per session and replay the result. `shareReplay(refCount: false)`
   * keeps the single value alive for later subscribers rather than re-hitting
   * the endpoint on every navigation. `catchError` sits inside the replay, so
   * a failed fetch caches `null` (USD hidden) instead of a thrown error.
   */
  private btcUsd$: Observable<number | null> | null = null;

  getBtcUsd(): Observable<number | null> {
    if (!this.base) return of(null);
    if (!this.btcUsd$) {
      this.btcUsd$ = this.http.get<PriceResponse>(`${this.base}/api/v1/prices`).pipe(
        map((p) => {
          const v = p?.USD;
          return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
        }),
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.btcUsd$;
  }
}
