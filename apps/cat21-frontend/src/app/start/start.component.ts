import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { combineLatest, map, retry, startWith, switchMap } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService, TestnetApiService } from '../openapi-client';


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

  private defaultItemsPerPage = 12;
  private lastTotalResults = 0;

  private api = inject(ApiService);
  private testnetApi = inject(TestnetApiService);
  private router = inject(Router);

  routing$ = inject(ActivatedRoute).paramMap.pipe(
    map(paramMap => ({
      itemsPerPage: parseInt(paramMap.get('itemsPerPage') || '') || this.defaultItemsPerPage,
      currentPage: parseInt(paramMap.get('currentPage') || '') || 1
    }))
  );

  testnet$ = inject(ActivatedRoute).data.pipe(
    map(data => !!data.testnet),
  );

  catsPaginated$ = combineLatest([
    this.routing$,
    this.testnet$
  ]).pipe(
    switchMap(([{ itemsPerPage, currentPage }, testnet]) => {

      return (!testnet ?
         this.api.cats(itemsPerPage, currentPage) :
         this.testnetApi.testnetCats(itemsPerPage, currentPage)
      ).pipe(
        retry({
          count: 3,
          delay: 1000
        }),
        startWith(this.emptyResult(itemsPerPage, currentPage))
      );
    })
  );

  emptyResult(itemsPerPage: number, currentPage: number) {
    return {
      cats: new Array(itemsPerPage), // array with x times undefined, which renders the "Loading..." text
      totalResults: this.lastTotalResults,
      itemsPerPage,
      currentPage,
    }
  }

  changePage(totalResults: number, itemsPerPage: number, currentPage: number, testnet:boolean) {
    this.lastTotalResults = totalResults;
    this.router.navigate([testnet ? '/testnet/' : '/', 'cats', itemsPerPage, currentPage]);
  }
}
