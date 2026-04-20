import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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

import { CatGallery } from '../cat-gallery/cat-gallery';
import { ApiService } from '../shared/cat21-api';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

@Component({
  selector: 'app-start',
  templateUrl: './start.html',
  imports: [RouterLink, NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationPrevious, NgbPaginationNext, CatGallery, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown.ArrowLeft)': 'navigatePrev()',
    '(window:keydown.ArrowRight)': 'navigateNext()',
    '(window:resize)': 'updateWindowWidth()',
  }
})
export class Start {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly itemsPerPage = input(48, { transform: numberAttribute });
  readonly currentPage = input(1, { transform: numberAttribute });

  catsResource = rxResourceFixed({
    params: () => ({ itemsPerPage: this.itemsPerPage() || 48, currentPage: this.currentPage() || 1 }),
    stream: ({ params }) => this.api.catsControllerGetCatNumbers(params.itemsPerPage, params.currentPage),
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

  changePage(itemsPerPage: number, currentPage: number) {
    this.router.navigate(['/', 'cats', itemsPerPage, currentPage]);
  }

  async reload() {
    await this.router.navigate(['/']);
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
