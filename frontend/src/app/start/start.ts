import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  NgbPagination,
  NgbPaginationEllipsis,
  NgbPaginationFirst,
  NgbPaginationLast,
  NgbPaginationNext,
  NgbPaginationPrevious,
} from '@ng-bootstrap/ng-bootstrap';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { ApiService, CatDto, CatSearchResultDto } from '../shared/cat21-api';
import { CategoryTabs } from '../shared/category-tabs/category-tabs';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

const DEFAULT_CATEGORY = 'sub1k';
const CATEGORY_TABS: readonly string[] = Object.values(CatDto.CategoryEnum)
  .filter((v): v is Exclude<typeof v, ''> => v !== '');

// Lowest cat number that opens each band — mirrors the canonical
// CATEGORY_RANGES table in cat21-indexer-backend/src/modules/shared/categories.ts.
// Used to hide tabs for bands that don't have any cats minted yet
// (e.g. sub250k stays hidden until cat #100 000 lands).
const CATEGORY_MIN: Record<string, number> = {
  sub1:    0,
  sub1k:   1,
  sub10k:  1_000,
  sub50k:  10_000,
  sub100k: 50_000,
  sub250k: 100_000,
  sub500k: 250_000,
  sub1M:   500_000,
};

@Component({
  selector: 'app-start',
  templateUrl: './start.html',
  imports: [RouterLink, NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationPrevious, NgbPaginationNext, CatGallery, CategoryTabs, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown.ArrowLeft)': 'navigatePrev()',
    '(window:keydown.ArrowRight)': 'navigateNext()',
    '(window:resize)': 'updateWindowWidth()',
  }
})
export class Start {
  private api = inject(ApiService);
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly itemsPerPage = input(48, { transform: numberAttribute });
  readonly currentPage = input(1, { transform: numberAttribute });
  readonly sort = input<string>('');
  readonly category = input<string>('');

  readonly activeSort = computed<'newest' | 'rarity'>(() => this.sort() === 'rarity' ? 'rarity' : 'newest');

  readonly activeCategory = computed<string>(() => {
    // withComponentInputBinding hands us undefined when the query param
    // is absent, even though the input() default is ''. Guard against it
    // before calling .split() or this computed throws on landing.
    const raw = (this.category() ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    return raw.length > 0 && CATEGORY_TABS.includes(raw[0]) ? raw[0] : DEFAULT_CATEGORY;
  });

  readonly categoryTabs = CATEGORY_TABS;

  /** Visible category tabs filtered by the latest synced cat number —
   *  bands whose first cat hasn't been minted yet stay hidden (sub250k+
   *  for the current supply). Before status arrives we show ONLY the
   *  active tab. Hiding first and revealing on data avoids the flicker
   *  of "everything → some things vanish" on first paint. */
  readonly visibleCategoryTabs = computed<readonly string[]>(() => {
    const last = this.statusResource.value()?.lastSyncedCatNumber ?? -1;
    if (last < 0) return [this.activeCategory()];
    return CATEGORY_TABS.filter((band) => last >= (CATEGORY_MIN[band] ?? 0));
  });

  readonly sortOptions = [
    ['newest', 'newest first'],
    ['rarity', 'rarest first'],
  ] as const;

  // The homepage uses the same backend as /search/ with no chip filters
  // — just a category scope. Strict band separation: every cat lives in
  // exactly one collection, so the gallery is always scoped to one. The
  // search endpoint returns facets we don't render here (~10 extra GROUP
  // BYs); cost is sub-100ms on the live dataset, not worth a parallel
  // endpoint just to skip that.
  catsResource = rxResourceFixed({
    params: () => ({
      itemsPerPage: this.itemsPerPage() || 48,
      currentPage: this.currentPage() || 1,
      sort: this.activeSort(),
      category: this.activeCategory(),
    }),
    stream: ({ params }) => {
      const httpParams = new HttpParams()
        .set('category', params.category)
        .set('sort', params.sort);
      const url = `${environment.api}/api/cats/search/${params.itemsPerPage}/${params.currentPage}`;
      return this.http.get<CatSearchResultDto>(url, { params: httpParams });
    },
  });

  statusResource = rxResourceFixed({
    params: () => ({}),
    stream: () => this.api.catsControllerGetStatus(),
  });

  catNumbers = computed(() => this.catsResource.value()?.catNumbers ?? []);
  placeholders = computed(() => new Array(this.itemsPerPage() || 48));

  readonly proofOfCatWorkSats = computed(() => this.statusResource.value()?.proofOfCatWork ?? 0);
  readonly proofOfCatWorkBtc = computed(() => this.proofOfCatWorkSats() / 100_000_000);

  readonly isBackendUnavailable = computed(() => {
    const err = this.catsResource.error();
    return err instanceof HttpErrorResponse && (err.status >= 500 || err.status === 0);
  });

  private readonly windowWidth = signal(typeof window === 'undefined' ? 1200 : window.innerWidth);
  // Narrower screens show fewer page numbers to prevent horizontal overflow.
  readonly pagerMaxSize = computed(() => {
    const w = this.windowWidth();
    if (w < 400) return 3;
    if (w < 600) return 5;
    return 7;
  });

  updateWindowWidth() {
    if (typeof window !== 'undefined') {
      this.windowWidth.set(window.innerWidth);
    }
  }

  /** Query params shared by every navigation from this page — preserves
   *  the active band + sort across pagination, tab switches, reload. */
  private bandQueryParams(overrides: Record<string, string | null> = {}): Record<string, string | null> {
    const cat = this.activeCategory();
    return {
      category: cat === DEFAULT_CATEGORY ? null : cat,
      sort: this.activeSort() === 'rarity' ? 'rarity' : null,
      ...overrides,
    };
  }

  changePage(itemsPerPage: number, currentPage: number) {
    this.router.navigate(['/', 'cats', itemsPerPage, currentPage], {
      queryParams: this.bandQueryParams(),
    });
  }

  setSort(value: string) {
    this.router.navigate(['/'], {
      queryParams: this.bandQueryParams({ sort: value === 'rarity' ? 'rarity' : null }),
    });
  }

  setCategory(value: string) {
    this.router.navigate(['/'], {
      queryParams: this.bandQueryParams({ category: value === DEFAULT_CATEGORY ? null : value }),
    });
  }

  async reload() {
    await this.router.navigate(['/'], { queryParams: this.bandQueryParams() });
    this.catsResource.reload();
  }

  navigatePrev() {
    const data = this.catsResource.value();
    if (!data || data.total === 0) return;
    if (data.currentPage > 1) {
      this.changePage(data.itemsPerPage, data.currentPage - 1);
    }
  }

  navigateNext() {
    const data = this.catsResource.value();
    if (!data || data.total === 0) return;
    const last = Math.ceil(data.total / data.itemsPerPage);
    if (data.currentPage < last) {
      this.changePage(data.itemsPerPage, data.currentPage + 1);
    }
  }
}
