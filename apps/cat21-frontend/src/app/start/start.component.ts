import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { EMPTY, map, Observable, retry, startWith } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService, Cat21, Cat21PaginatedResult, TestnetApiService } from '../openapi-client';


@Component({
  selector: 'app-start',
  templateUrl: './start.component.html',
  styleUrls: ['./start.component.scss'],
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    RouterLink,
    NgbPagination,
    AsyncPipe,
    Cat21ViewerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StartComponent {

  private api = inject(ApiService);
  private testnetApi = inject(TestnetApiService);
  private isTestnet = false;

  testnet$ = inject(ActivatedRoute).data.pipe(
    map(data => !!data.testnet),
  );

  defaultItemsPerPage = 12;
  catsPaginated$: Observable<{
    cats: Array<Cat21 | undefined>;
    totalResults: number;
    itemsPerPage: number;
    currentPage: number;
  }> = EMPTY;


  constructor() {
    this.testnet$.subscribe(testnet => {
      this.isTestnet = testnet;
      this.catsPaginated$ = this.loadCats()
    })

  }

  emptyResult(totalResults: number, itemsPerPage: number, currentPage: number) {
    return {
      cats: new Array(itemsPerPage), // array with x times undefined, which renders the "Loading..." text
      totalResults,
      itemsPerPage,
      currentPage,
    }
  }

  loadCats(totalResults?: number, itemsPerPage?: number, currentPage = 1) {

    totalResults = totalResults || this.defaultItemsPerPage;
    itemsPerPage = itemsPerPage || this.defaultItemsPerPage;

    let api: Observable<Cat21PaginatedResult>;
    if (!this.isTestnet) {
      api = this.api.cats(itemsPerPage, currentPage);
    } else {
      api = this.testnetApi.testnetCats(itemsPerPage, currentPage);
    }

    return api.pipe(
      retry({
        count: 3,
        delay: 1000
      }),
      startWith(this.emptyResult(totalResults, itemsPerPage, currentPage))
    );
  }

  changePage(totalResults: number, itemsPerPage: number, currentPage: number) {
    this.catsPaginated$ = this.loadCats(totalResults, itemsPerPage, currentPage);
  }
}
