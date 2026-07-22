import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, of, switchMap, throwError } from 'rxjs';

import { WalletService } from 'ordpool-sdk';

import { environment } from '../../environments/environment';

/**
 * The backend's bid record (mirror of `BidDto` in
 * `cat21-indexer/backend`). `psbt_base64` is the raw half-signed
 * artifact — the seller signs input 0 + broadcasts to close the
 * trade.
 */
export interface PersistedCat21Bid {
  id: string;
  network: string;
  catTxid: string;
  catVout: number;
  cats: number[];
  headlineCatNumber: number;
  bidSats: number;
  buyerOrdinalsAddress: string;
  buyerPaymentAddress: string;
  sellerPaymentAddress: string;
  psbtBase64: string;
  createdAt: string;
}

/**
 * Every backend error code the bids POST/GET/DELETE endpoints can
 * return. Kept as a discriminated union so the UI can map to
 * human messages without regex-matching on strings.
 */
export type BidErrorCode =
  | 'network-mismatch'
  | 'headline-not-in-bundle'
  | 'bid-below-marketplace-floor'
  | 'psbt-malformed'
  | 'psbt-shape-invalid'
  | 'psbt-input0-mismatch'
  | 'psbt-output0-mismatch'
  | 'psbt-output1-mismatch'
  | 'psbt-output2-mismatch'
  | 'psbt-price-mismatch'
  // Additional psbt-* codes propagated from the SDK offer validator
  // (`psbt-sighash-not-all`, `psbt-sighash-flag-byte-not-all`,
  // `psbt-buyer-input-unsigned`, etc.). Kept as a wildcard tail so
  // the UI has a category to map to.
  | `psbt-${string}`
  | 'ord-lookup-failed'
  | 'cat-not-found'
  | 'cats-bundle-drift'
  | 'persist-race'
  | 'wallet-not-connected'
  | 'network-error';

export interface BidError {
  code: BidErrorCode;
  detail: string;
}

/**
 * Client for the bids marketplace. Read-only in this slice (X.4);
 * bid submission (X.5) and seller accept (X.6) land in follow-ups.
 *
 * Uniqueness at the API level is (network, cat_txid, cat_vout,
 * buyer_ordinals_address). This service exposes lookups by outpoint
 * (all bids on this UTXO, sorted price DESC — the seller's view)
 * and a paginated feed (browse everyone's bids).
 */
/**
 * What the buyer's UI hands to `postBid` — the load-bearing values
 * live in the half-signed PSBT bytes, but the backend also wants
 * discovery metadata (cats, addresses, price) for indexed lookups.
 * We ask the caller for both AND cross-check server-side: any lie
 * about the price gets caught before insert.
 */
export interface PostBidArgs {
  catTxid: string;
  catVout: number;
  cats: number[];
  headlineCatNumber: number;
  bidSats: number;
  buyerOrdinalsAddress: string;
  buyerPaymentAddress: string;
  sellerPaymentAddress: string;
  psbtBase64: string;
}

@Injectable({ providedIn: 'root' })
export class Cat21BidsService {
  private http = inject(HttpClient);
  private walletService = inject(WalletService);

  private readonly baseUrl = `${environment.api}/api/v1/bids`;

  /**
   * Post a buyer's half-signed PSBT to the marketplace. The PSBT's
   * own SIGHASH_ALL sigs on inputs 1..N are the auth; no BIP-322
   * wrap needed. Network comes from the connected wallet.
   *
   * Errors bubble up as `BidError` with the backend's specific
   * failure code (`network-mismatch`, `psbt-price-mismatch`,
   * `cats-bundle-drift`, `bid-below-marketplace-floor`, …). The UI
   * maps the code to a human message.
   */
  postBid(args: PostBidArgs): Observable<PersistedCat21Bid> {
    const wallet = this.walletService.connectedWallet$.getValue();
    if (!wallet) {
      return throwError(() => ({
        code: 'wallet-not-connected' as const,
        detail: 'Connect a wallet before posting a bid.',
      }));
    }
    const network = this.walletService.network;
    return of({
      network,
      catTxid: args.catTxid,
      catVout: args.catVout,
      cats: args.cats,
      headlineCatNumber: args.headlineCatNumber,
      bidSats: args.bidSats,
      buyerOrdinalsAddress: args.buyerOrdinalsAddress,
      buyerPaymentAddress: args.buyerPaymentAddress,
      sellerPaymentAddress: args.sellerPaymentAddress,
      psbtBase64: args.psbtBase64,
    }).pipe(
      switchMap((body) =>
        this.http
          .post<PersistedCat21Bid>(this.baseUrl, body)
          .pipe(catchError((err) => throwError(() => this.mapHttpError(err)))),
      ),
    );
  }

  /**
   * All active bids on a specific UTXO, sorted `bidSats` DESC then
   * most-recent first. Empty array is a valid response (no bids on
   * this UTXO yet). Errors map to `BidError` via `mapHttpError`.
   */
  getBidsForOutpoint(catTxid: string, catVout: number): Observable<PersistedCat21Bid[]> {
    return this.http
      .get<PersistedCat21Bid[]>(`${this.baseUrl}/outpoint/${catTxid}/${catVout}`)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // Empty is legit; anything else propagates.
          if (err.status === 404) return of([]);
          return throwError(() => this.mapHttpError(err));
        }),
      );
  }

  /**
   * Delete a bid by (outpoint, buyer). No signature required — the
   * backend gates on the unique key. Used by the future buyer-side
   * cancel flow; for X.4 (read-only) this is exposed but unused.
   */
  deleteBid(catTxid: string, catVout: number, buyerOrdinalsAddress: string): Observable<void> {
    const url = `${this.baseUrl}/outpoint/${catTxid}/${catVout}?buyer=${encodeURIComponent(buyerOrdinalsAddress)}`;
    return this.http.delete<void>(url).pipe(
      catchError((err: HttpErrorResponse) => throwError(() => this.mapHttpError(err))),
    );
  }

  /**
   * Same shape as `Cat21ListingService.mapHttpError`. Backend
   * responds with `{code, detail}` in the body for BadRequests;
   * pass those through. Network errors get a generic
   * `network-error` code.
   */
  private mapHttpError(err: unknown): BidError {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { code?: string; detail?: string } | undefined;
      if (body?.code) {
        return {
          code: body.code as BidErrorCode,
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
