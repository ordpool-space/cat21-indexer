import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';

import {
  buildListingMessage,
  Cat21Listing,
  ListingMessageFields,
  toOrdinalsAddress,
  toPaymentAddress,
  WalletService,
} from 'ordpool-sdk';

import { environment } from '../../environments/environment';

/**
 * What the backend stores + returns — the canonical signed
 * `Cat21Listing` plus server-assigned `id` and `createdAt`. The
 * signature still verifies against the message rebuilt from the
 * canonical fields alone (id + createdAt are NOT part of the
 * message); the two extras exist only for row identity and freshness
 * display.
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
  | 'signature-malformed-signature'
  | 'signature-unsupported-address-type'
  | 'signature-invalid-address'
  | 'signature-signature-does-not-verify'
  | 'signature-too-old'
  | 'signature-in-future'
  | 'network-mismatch'
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
  | 'network-error';

export interface CreateListingError {
  code: CreateListingErrorCode;
  detail: string;
}

/**
 * Args for `Cat21ListingService.publishListing`. The caller supplies
 * the four seller-known fields; the service composes them with the
 * connected wallet's ordinals address + a fresh `signedAt`, asks the
 * wallet to sign via BIP-322, and POSTs to the backend.
 */
export interface PublishListingArgs {
  catNumber: number;
  askSats: number;
  /** Cat's current on-chain outpoint (from `CatUtxoLookupService`). */
  catTxid: string;
  catVout: number;
  /**
   * Every cat currently riding on the UTXO (`OrdApiService.getCatsAtOutput`).
   * The seller signs the full bundle so the buyer sees exactly what
   * they're paying for — a PSBT spends the whole UTXO, so a lower-
   * numbered bundle-mate would come with the sale even if not
   * headlined. Backend cross-checks against ord and rejects on drift.
   */
  cats: number[];
}

/**
 * Composes the CAT-21 orderbook publish flow: build the canonical
 * message → ask the connected wallet to sign it (BIP-322 via
 * `WalletService.signMessage`) → POST to `/api/v1/listings`.
 *
 * The wallet's `paymentAddress` is what lands on the seller-payment
 * output when a buyer accepts the offer — read straight from the
 * connected wallet. NEVER derived from an on-chain lookup (SDK HARD
 * RULE); the branded `PaymentAddress` type enforces this at every
 * consumer boundary.
 *
 * Errors bubble up as `CreateListingError` with codes the sell-modal
 * UI can map to human messages.
 */
@Injectable({ providedIn: 'root' })
export class Cat21ListingService {
  private http = inject(HttpClient);
  private walletService = inject(WalletService);

  private readonly baseUrl = `${environment.api}/api/v1/listings`;

  publishListing(args: PublishListingArgs): Observable<PersistedCat21Listing> {
    const wallet = this.walletService.connectedWallet$.getValue();
    if (!wallet) {
      return throwError(() => ({
        code: 'wallet-not-connected' as const,
        detail: 'Connect a wallet before publishing a listing.',
      }));
    }

    const signedAt = Math.floor(Date.now() / 1000);
    const network = this.walletService.network;
    // Snapshot the wallet identity at message-build time. The wallet
    // signMessage RPC is async and the user could swap wallets in the
    // extension between call-open and RPC-return; if that happens,
    // wallet B's signature would land on wallet A's fields and the
    // POST would attribute the listing to the wrong party. Post-sign
    // we compare `walletAtSignTime` against `connectedWallet$` and
    // fail closed on mismatch.
    const walletAtSignTime = wallet;
    // Build the canonical message the wallet will sign. The backend
    // rebuilds this same message from the DTO fields to verify, so
    // any drift here breaks the signature verify server-side. Fields
    // are branded at this seam — payTo comes from the wallet's
    // paymentAddress (never an on-chain lookup), ordinalsAddress
    // from the wallet's ordinalsAddress.
    const fields: ListingMessageFields = {
      catNumber: args.catNumber,
      cats: args.cats,
      network,
      askSats: args.askSats,
      payTo: toPaymentAddress(wallet.paymentAddress),
      catTxid: args.catTxid,
      catVout: args.catVout,
      ordinalsAddress: toOrdinalsAddress(wallet.ordinalsAddress),
      signedAt,
    };

    let message: string;
    try {
      message = buildListingMessage(fields);
    } catch (err) {
      return throwError(() => ({
        code: 'invalid-listing-fields' as const,
        detail: err instanceof Error ? err.message : String(err),
      }));
    }

    return this.walletService
      .signMessage({
        address: wallet.ordinalsAddress,
        message,
        network,
      })
      .pipe(
        catchError((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          return throwError(() => ({
            code: 'wallet-signature-failed' as CreateListingErrorCode,
            detail,
          }));
        }),
        switchMap((result) => {
          // Wallet-swap race check — if the connected wallet changed
          // while the signMessage RPC was in flight, the returned
          // signature was produced by a different wallet than the one
          // whose ordinalsAddress + paymentAddress are baked into
          // `fields`. Refuse to POST rather than silently attribute
          // the signature to the wrong wallet.
          const current = this.walletService.connectedWallet$.getValue();
          if (
            !current ||
            current.ordinalsAddress !== walletAtSignTime.ordinalsAddress ||
            current.paymentAddress !== walletAtSignTime.paymentAddress
          ) {
            return throwError(() => ({
              code: 'wallet-swapped-mid-sign' as CreateListingErrorCode,
              detail:
                'The connected wallet changed while signing. Reconnect the original wallet and retry.',
            }));
          }
          return this.http
            .post<PersistedCat21Listing>(this.baseUrl, {
              ...fields,
              signature: result.signature,
            })
            .pipe(catchError((err) => throwError(() => this.mapHttpError(err))));
        }),
      );
  }

  /**
   * GET the active listing for a cat, or null if none. Frontend uses
   * this to show "Listed for X sats" on the details page. 404 maps
   * to null (not-listed is a normal state); everything else throws
   * a CreateListingError.
   */
  getListingForCat(catNumber: number): Observable<PersistedCat21Listing | null> {
    return this.http
      .get<PersistedCat21Listing>(`${this.baseUrl}/cat/${catNumber}`)
      .pipe(
        map((listing) => listing as PersistedCat21Listing | null),
        catchError((err: HttpErrorResponse) => {
          if (err.status === 404) return of(null);
          return throwError(() => this.mapHttpError(err));
        }),
      );
  }

  /**
   * Map a HTTP error into a `CreateListingError`. The backend
   * responds with `{code, detail}` in the body for BadRequest;
   * pass those through. Network errors (no response) get a generic
   * `network-error` code.
   */
  private mapHttpError(err: unknown): CreateListingError {
    if (err instanceof HttpErrorResponse) {
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
