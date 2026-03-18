import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { rxResourceFixed } from '../shared/utils/rx-resource-fixed';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationNext, NgbPaginationPrevious } from '@ng-bootstrap/ng-bootstrap';
import { map } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService, CatsPaginatedResultDto } from '../openapi-client';

@Component({
    selector: 'app-start',
    templateUrl: './start.component.html',
    styleUrls: ['./start.component.scss'],
    imports: [RouterLink, NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationPrevious, NgbPaginationNext, Cat21ViewerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
      '(window:keydown.ArrowLeft)': 'navigatePrev()',
      '(window:keydown.ArrowRight)': 'navigateNext()',
    }
})
export class StartComponent {
  private defaultItemsPerPage = 48;
  private api = inject(ApiService);
  private router = inject(Router);

  private routing = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((paramMap) => ({
        itemsPerPage: parseInt(paramMap.get('itemsPerPage') || '') || this.defaultItemsPerPage,
        currentPage: parseInt(paramMap.get('currentPage') || '') || 1,
      })),
    ),
    { initialValue: { itemsPerPage: this.defaultItemsPerPage, currentPage: 1 } }
  );

  catsResource = rxResourceFixed({
    params: () => this.routing(),
    stream: ({ params }) => this.api.catsControllerGetCats(params.itemsPerPage, params.currentPage),
  });

  cats = computed(() => this.catsResource.value());

  // Placeholder array for loading skeleton
  placeholders = computed(() => new Array(this.routing().itemsPerPage));

  changePage(total: number, itemsPerPage: number, currentPage: number) {
    this.router.navigate(['/', 'cats', itemsPerPage, currentPage]);
  }

  lastPage(total: number, itemsPerPage: number): number {
    return Math.ceil(total / itemsPerPage);
  }

  reload() {
    this.router.navigate(['/']);
    this.catsResource.reload();
  }

  navigatePrev() {
    const data = this.cats();
    if (!data || data.total === 0) return;
    if (data.currentPage > 1) {
      this.changePage(data.total, data.itemsPerPage, data.currentPage - 1);
    }
  }

  navigateNext() {
    const data = this.cats();
    if (!data || data.total === 0) return;
    const last = this.lastPage(data.total, data.itemsPerPage);
    if (data.currentPage < last) {
      this.changePage(data.total, data.itemsPerPage, data.currentPage + 1);
    }
  }
}
