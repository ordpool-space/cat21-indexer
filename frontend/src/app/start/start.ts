import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { rxResourceFixed } from '../shared/utils/rx-resource-fixed';
import { Router, RouterLink } from '@angular/router';
import { NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationNext, NgbPaginationPrevious } from '@ng-bootstrap/ng-bootstrap';

import { Cat21Viewer } from '../cat21-viewer/cat21-viewer';
import { ApiService } from '../openapi-client';

@Component({
    selector: 'app-start',
    templateUrl: './start.html',
    styleUrl: './start.scss',
    imports: [RouterLink, NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationPrevious, NgbPaginationNext, Cat21Viewer],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
      '(window:keydown.ArrowLeft)': 'navigatePrev()',
      '(window:keydown.ArrowRight)': 'navigateNext()',
    }
})
export class Start {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly itemsPerPage = input(48, { transform: numberAttribute });
  readonly currentPage = input(1, { transform: numberAttribute });

  catsResource = rxResourceFixed({
    params: () => ({ itemsPerPage: this.itemsPerPage() || 48, currentPage: this.currentPage() || 1 }),
    stream: ({ params }) => this.api.catsControllerGetCats(params.itemsPerPage, params.currentPage),
  });

  placeholders = computed(() => new Array(this.itemsPerPage() || 48));

  changePage(total: number, itemsPerPage: number, currentPage: number) {
    this.router.navigate(['/', 'cats', itemsPerPage, currentPage]);
  }

  reload() {
    this.router.navigate(['/']).then(() => this.catsResource.reload());
  }

  navigatePrev() {
    const data = this.catsResource.value();
    if (!data || data.total === 0) return;
    if (data.currentPage > 1) {
      this.changePage(data.total, data.itemsPerPage, data.currentPage - 1);
    }
  }

  navigateNext() {
    const data = this.catsResource.value();
    if (!data || data.total === 0) return;
    const last = Math.ceil(data.total / data.itemsPerPage);
    if (data.currentPage < last) {
      this.changePage(data.total, data.itemsPerPage, data.currentPage + 1);
    }
  }
}
