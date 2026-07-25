import { inject, Injectable } from '@angular/core';
import { Observable, from, of, switchMap, throwError } from 'rxjs';

import {
  buildCat21SessionMessage,
  CAT21_SESSION_VALIDITY_MS,
  WalletService,
} from 'ordpool-sdk';

/**
 * Session-token capability layer for the cat21-indexer frontend.
 *
 * The user signs ONE BIP-322 message per ~24h ("Cat21 session: I
 * control <addr>, valid until <iso>"); every marketplace mutation
 * (CREATE listing, DELETE listing, DELETE bid) attaches three
 * headers derived from the cached session, and the backend
 * Cat21SessionGuard verifies them.
 *
 * Cache key: the ordinals address. A wallet swap ends the effective
 * session; the new address requires a fresh signature. Storage:
 * `localStorage[cat21-session-<address>]` — same origin as the app;
 * a leaked token grants the marketplace-grief capability for the
 * remainder of its window, but cannot cost anyone Bitcoin
 * (workspace CLAUDE.md philosophy: PSBT + Bitcoin is the ledger).
 */
/**
 * Plain string-keyed record so it slots directly into Angular's
 * `new HttpHeaders(...)` constructor (which wants a Record-shaped
 * index signature, not a typed interface).
 */
export type Cat21SessionHeaders = {
  [key: string]: string;
} & {
  'X-Cat21-Session-Address': string;
  'X-Cat21-Session-Valid-Until': string;
  'X-Cat21-Session-Signature': string;
};

interface CachedSession {
  address: string;
  validUntilIso: string;
  signature: string;
}

const STORAGE_KEY_PREFIX = 'cat21-session-';

/**
 * Grace window at the client — if a cached session expires within
 * the next 60 seconds, refresh it proactively so a mutation doesn't
 * cross the wire with a token that's already expired by the time
 * the backend reads it.
 */
const CLIENT_REFRESH_GRACE_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class Cat21SessionService {
  private walletService = inject(WalletService);

  /**
   * Return headers for a request that must authenticate as
   * `address`. Prompts the wallet for a fresh session sig if none
   * cached, expired, or approaching expiry. Errors if no wallet is
   * connected or the wallet doesn't own `address`.
   */
  headersFor(address: string): Observable<Cat21SessionHeaders> {
    return this.ensureCachedSession(address).pipe(
      switchMap((cached) =>
        of({
          'X-Cat21-Session-Address': cached.address,
          'X-Cat21-Session-Valid-Until': cached.validUntilIso,
          'X-Cat21-Session-Signature': cached.signature,
        }),
      ),
    );
  }

  /**
   * Wipe the cached session for `address`. Call this on a 401 from
   * the backend (session server-side rejected — probably clock drift
   * or an old cache) so the next attempt prompts for a fresh sign.
   */
  clearFor(address: string): void {
    try {
      localStorage.removeItem(this.keyFor(address));
    } catch {
      // Ignore quota / opaque-origin errors — the cache is best-effort.
    }
  }

  private ensureCachedSession(address: string): Observable<CachedSession> {
    const cached = this.readCache(address);
    const nowMs = Date.now();
    if (
      cached &&
      Date.parse(cached.validUntilIso) - nowMs > CLIENT_REFRESH_GRACE_MS
    ) {
      return of(cached);
    }
    return this.signFreshSession(address, nowMs);
  }

  private signFreshSession(address: string, nowMs: number): Observable<CachedSession> {
    const wallet = this.walletService.connectedWallet$.getValue();
    if (!wallet) {
      return throwError(() => new Error('wallet-not-connected'));
    }
    if (wallet.ordinalsAddress !== address) {
      return throwError(
        () => new Error(`connected wallet controls ${wallet.ordinalsAddress}, not ${address}`),
      );
    }
    const validUntilIso = new Date(nowMs + CAT21_SESSION_VALIDITY_MS).toISOString();
    const message = buildCat21SessionMessage({ address, validUntilIso });
    return this.walletService
      .signMessage({
        address,
        message,
        network: this.walletService.network,
      })
      .pipe(
        switchMap((result) => {
          const session: CachedSession = {
            address,
            validUntilIso,
            signature: result.signature,
          };
          this.writeCache(session);
          return of(session);
        }),
      );
  }

  private readCache(address: string): CachedSession | null {
    try {
      const raw = localStorage.getItem(this.keyFor(address));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedSession;
      if (
        parsed &&
        typeof parsed.address === 'string' &&
        typeof parsed.validUntilIso === 'string' &&
        typeof parsed.signature === 'string' &&
        parsed.address === address
      ) {
        return parsed;
      }
      return null;
    } catch {
      // Malformed cache entry — treat as absent so the caller re-prompts.
      return null;
    }
  }

  private writeCache(session: CachedSession): void {
    try {
      localStorage.setItem(this.keyFor(session.address), JSON.stringify(session));
    } catch {
      // Quota / opaque-origin — the sign will still succeed for this
      // request; the next one just re-prompts.
    }
  }

  private keyFor(address: string): string {
    return `${STORAGE_KEY_PREFIX}${address}`;
  }
}
