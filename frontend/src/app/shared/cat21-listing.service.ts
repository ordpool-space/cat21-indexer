import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';

import {
  Cat21Listing,
  WalletService,
} from 'ordpool-sdk';

import { environment } from '../../environments/environment';
import { Cat21SessionService } from './cat21-session.service';

/**
 * What the backend stores + returns. Historical per-listing BIP-322
 * fields (`signedAt`, `signature`) remain in the DB row for backwards
 * compat but are no longer authoritative — CREATE listing now
 * authenticates via the session-token layer.
 */
export interface PersistedCat21Listing extends Cat21Listing {
  id: string;
  createdAt: string;
}

/**
 * The backend's create-listing error codes (see cat21-indexer/backend
 * ListingsController). Kept as a discriminated union so the UI can
 * surface the right human message without regex-matching on strings.
 */
export type CreateListingErrorCode =
  | 'invalid-listing-fields'
  | 'network-mismatch'
  | 'session-address-mismatch'
  | 'headline-not-in-bundle'
  | 'cats-bundle-drift'
  | 'ord-lookup-failed'
  | 'cat-not-found'
  | 'not-current-owner'
  | 'outpoint-mismatch'
  | 'persist-race'
  | 'wallet-signature-failed'
  | 'wallet-swapped-mid-sign'
  | 'wallet-not-connected'
  | 'network-error'
  // Session-guard rejections (401 from Cat21SessionGuard):
  | 'session-headers-missing'
  | 'session-malformed-timestamp'
  | 'session-expired'
  | 'session-too-far-in-future'
  | 'session-signature-does-not-verify'
  | 'session-malformed-signature'
  | 'session-invalid-address'
  | 'session-unsupported-address-type';

export interface CreateListingError {
  code: CreateListingErrorCode;
  detail: string;
}

/**
 * Args for `Cat21ListingService.publishListing`. The caller supplies
 * the seller-known fields; the service composes them with the
 * connected wallet's addresses, obtains a session token (may prompt
 * the wallet the first time this session), and POSTs.
 */
export interface PublishListingArgs {
  catNumber: number;
  askSats: number;
  /** Cat's current on-chain outpoint (from `CatUtxoLookupService`). */
  catTxid: string;
  catVout: number;
  /**
   * Every cat currently riding on the UTXO. Backend cross-checks
   * against ord's live bundle and rejects on drift.
   */
  cats: number[];
}

/**
 * Composes the CAT-21 orderbook publish flow: build the DTO from the
 * connected wallet's identity → attach session-token headers via
 * `Cat21SessionService` → POST to `/api/v1/listings`.
 *
 * The wallet's `paymentAddress` lands on the seller-payment output
 * when a buyer accepts — read straight from the connected wallet.
 * NEVER derived from an on-chain lookup (SDK HARD RULE).
 *
 * The session-token layer replaces per-listing BIP-322 signatures.
 * Rationale (workspace CLAUDE.md): the marketplace layer is
 * convenience; the tamper-proof record is the PSBT + Bitcoin as the
 * ledger. A leaked session token can grief the marketplace but
 * cannot cost anyone Bitcoin — accepting a listing still requires
 * the buyer to sign a real PSBT the seller countersigns.
 */
@Injectable({ providedIn: 'root' })
export class Cat21ListingService {
  private http = inject(HttpClient);
  private walletService = inject(WalletService);
  private session = inject(Cat21SessionService);

  private readonly baseUrl = `${environment.api}/api/v1/listings`;

  publishListing(args: PublishListingArgs): Observable<PersistedCat21Listing> {
    const wallet = this.walletService.connectedWallet$.getValue();
    if (!wallet) {
      return throwError(() => ({
        code: 'wallet-not-connected' as const,
        detail: 'Connect a wallet before publishing a listing.',
      }));
    }

    const dto = {
      catNumber: args.catNumber,
      cats: args.cats,
      network: this.walletService.network,
      askSats: args.askSats,
      payTo: wallet.paymentAddress,
      catTxid: args.catTxid,
      catVout: args.catVout,
      ordinalsAddress: wallet.ordinalsAddress,
    };

    return this.session.headersFor(wallet.ordinalsAddress).pipe(
      catchError((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        return throwError(() => ({
          code: 'wallet-signature-failed' as CreateListingErrorCode,
          detail: `Session sign failed: ${detail}`,
        }));
      }),
      switchMap((headers) =>
        this.http
          .post<PersistedCat21Listing>(this.baseUrl, dto, { headers: new HttpHeaders(headers) })
          .pipe(catchError((err) => throwError(() => this.mapHttpError(err, wallet.ordinalsAddress)))),
      ),
    );
  }

  /**
   * Delete the caller's own listing for a cat. Requires session
   * auth (the backend enforces ownership: session address must
   * match the listing's ordinalsAddress).
   */
  deleteListingForCat(catNumber: number): Observable<void> {
    const wallet = this.walletService.connectedWallet$.getValue();
    if (!wallet) {
      return throwError(() => ({
        code: 'wallet-not-connected' as const,
        detail: 'Connect a wallet before deleting a listing.',
      }));
    }
    return this.session.headersFor(wallet.ordinalsAddress).pipe(
      switchMap((headers) =>
        this.http
          .delete<void>(`${this.baseUrl}/cat/${catNumber}`, { headers: new HttpHeaders(headers) })
          .pipe(catchError((err) => throwError(() => this.mapHttpError(err, wallet.ordinalsAddress)))),
      ),
    );
  }

  /**
   * GET the active listing for a cat, or null if none. 404 maps to
   * null; everything else throws a CreateListingError.
   */
  getListingForCat(catNumber: number): Observable<PersistedCat21Listing | null> {
    return this.http
      .get<PersistedCat21Listing>(`${this.baseUrl}/cat/${catNumber}`)
      .pipe(
        map((listing) => listing as PersistedCat21Listing | null),
        catchError((err: HttpErrorResponse) => {
          if (err.status === 404) return of(null);
          return throwError(() => this.mapHttpError(err, null));
        }),
      );
  }

  /**
   * Map a HTTP error into a `CreateListingError`. On a 401 (session
   * token rejected by the backend guard), clear the cached session
   * for the address so the next attempt re-prompts.
   */
  private mapHttpError(err: unknown, addressToClearOn401: string | null): CreateListingError {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401 && addressToClearOn401) {
        this.session.clearFor(addressToClearOn401);
      }
      const body = err.error as { code?: string; detail?: string } | undefined;
      if (body?.code) {
        return {
          code: body.code as CreateListingErrorCode,
          detail: body.detail ?? err.statusText,
        };
      }
      return {
        code: 'network-error',
        detail: `${err.status} ${err.statusText}`,
      };
    }
    return {
      code: 'network-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
