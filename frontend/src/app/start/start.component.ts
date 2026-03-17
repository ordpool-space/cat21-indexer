import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationNext, NgbPaginationPages, NgbPaginationPrevious } from '@ng-bootstrap/ng-bootstrap';
import { filter, fromEvent, map, retry, startWith, Subject, switchMap, withLatestFrom } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService, CatsPaginatedResultDto } from '../openapi-client';

@Component({
    selector: 'app-start',
    templateUrl: './start.component.html',
    styleUrls: ['./start.component.scss'],
    imports: [RouterLink, NgbPagination, NgbPaginationEllipsis, NgbPaginationFirst, NgbPaginationLast, NgbPaginationPrevious, NgbPaginationNext, NgbPaginationPages, AsyncPipe, Cat21ViewerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class StartComponent {
  private defaultItemsPerPage = 48;
  private lastTotal = 0;

  private api = inject(ApiService);
  private router = inject(Router);
  private reload$ = new Subject<void>();

  constructor() {
    fromEvent<KeyboardEvent>(window, 'keydown').pipe(
      filter((e) => e.key === 'ArrowLeft' || e.key === 'ArrowRight'),
      withLatestFrom(this.catsPaginated$),
      takeUntilDestroyed(),
    ).subscribe(([event, page]) => {
      if (page.total === 0) return;
      const last = this.lastPage(page.total, page.itemsPerPage);
      if (event.key === 'ArrowLeft' && page.currentPage > 1) {
        this.changePage(page.total, page.itemsPerPage, page.currentPage - 1);
      }
      if (event.key === 'ArrowRight' && page.currentPage < last) {
        this.changePage(page.total, page.itemsPerPage, page.currentPage + 1);
      }
    });
  }

  routing$ = inject(ActivatedRoute).paramMap.pipe(
    map((paramMap) => ({
      itemsPerPage: parseInt(paramMap.get('itemsPerPage') || '') || this.defaultItemsPerPage,
      currentPage: parseInt(paramMap.get('currentPage') || '') || 1,
    })),
  );

  catsPaginated$ = this.routing$.pipe(
    switchMap(({ itemsPerPage, currentPage }) =>
      this.reload$.pipe(
        startWith(undefined),
        switchMap(() =>
          this.api.catsControllerGetCats(itemsPerPage, currentPage).pipe(
            retry({ count: 3, delay: 1000 }),
            startWith(this.emptyResult(itemsPerPage, currentPage)),
          ),
        ),
      ),
    ),
  );

  emptyResult(itemsPerPage: number, currentPage: number): CatsPaginatedResultDto {
    return {
      cats: new Array(itemsPerPage),
      total: this.lastTotal,
      itemsPerPage,
      currentPage,
    };
  }

  changePage(total: number, itemsPerPage: number, currentPage: number) {
    this.lastTotal = total;
    this.router.navigate(['/', 'cats', itemsPerPage, currentPage]);
  }

  lastPage(total: number, itemsPerPage: number): number {
    return Math.ceil(total / itemsPerPage);
  }

  reload() {
    this.router.navigate(['/']);
    this.reload$.next();
  }
}
