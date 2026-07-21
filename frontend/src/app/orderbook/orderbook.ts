import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { buildBuyOfferQueryParams } from 'ordpool-sdk';

import { environment } from '../../environments/environment';
import { PersistedCat21Listing } from '../shared/cat21-listing.service';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

/**
 * Positive-integer `input()` transform with a fallback for the
 * missing / malformed case. `numberAttribute(undefined)` returns
 * `NaN`, and Angular's route-binding fires `undefined` on
 * `/orderbook` (the paramless companion of `/orderbook/:ipp/:page`).
 * Without a guard the resource then GETs `/api/v1/listings/NaN/NaN`
 * and the API's ParseIntPipe 400s.
 */
const positiveIntAttr =
  (fallback: number) =>
  (v: string | number | boolean | undefined | null): number => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };

/**
 * Server-side paginated feed shape returned by
 * GET /api/v1/listings/:itemsPerPage/:currentPage. Mirrors the
 * PaginatedListingsDto in cat21-indexer/backend.
 */
interface PaginatedListings {
  total: number;
  currentPage: number;
  itemsPerPage: number;
  items: PersistedCat21Listing[];
}

const DEFAULT_ITEMS_PER_PAGE = 25;

/**
 * The CAT-21 orderbook — a paginated feed of active seller-signed
 * listings. Every row is publicly re-verifiable (the BIP-322
 * signature travels with the row, and any consumer can rebuild the
 * canonical message via `buildListingMessage` and validate it via
 * `verifyListingSignature`).
 *
 * "Active" here means "still present in the backend's `listings`
 * table". The backend prunes hourly against on-chain state — rows
 * for cats that have moved to a new UTXO disappear automatically.
 */
@Component({
  selector: 'app-orderbook',
  templateUrl: './orderbook.html',
  styleUrl: './orderbook.scss',
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Orderbook {
  private http = inject(HttpClient);
  private router = inject(Router);

  private readonly baseUrl = `${environment.api}/api/v1/listings`;

  readonly itemsPerPage = input(DEFAULT_ITEMS_PER_PAGE, { transform: positiveIntAttr(DEFAULT_ITEMS_PER_PAGE) });
  readonly currentPage = input(1, { transform: positiveIntAttr(1) });

  readonly feedResource = rxResourceFixed({
    params: () => ({
      ipp: this.itemsPerPage(),
      page: this.currentPage(),
    }),
    stream: ({ params }) =>
      this.http
        .get<PaginatedListings>(`${this.baseUrl}/${params.ipp}/${params.page}`)
        .pipe(catchError(() => of(null))),
  });

  readonly totalPages = computed<number>(() => {
    const feed = this.feedResource.value();
    if (!feed) return 1;
    return Math.max(1, Math.ceil(feed.total / feed.itemsPerPage));
  });

  /**
   * Build the deep-link query the "Buy" button on each row hands to
   * `/dashboard/trade/make`. Threads through everything the seller
   * signed so make-offer's stale-detection can compare against the
   * cat's current outpoint — a listing that's been sitting between
   * the backend's hourly prunes and now might already be void even
   * though the row is present.
   */
  buyQueryParams(row: PersistedCat21Listing): Record<string, string> {
    return buildBuyOfferQueryParams({
      catNumber: row.catNumber,
      askSats: row.askSats,
      sellerPaymentAddress: row.payTo,
      catOutpoint: { txid: row.catTxid, vout: row.catVout },
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    this.router.navigate(['/orderbook', this.itemsPerPage(), page]);
  }
}
