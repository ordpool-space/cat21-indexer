import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { Observable, of, retry, startWith } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { AlertComponent } from '../layout/alert/alert.component';
import { LoadingIndicatorButtonComponent } from '../layout/loading-indicator-button/loading-indicator-button.component';
import { LoadingIndicatorComponent } from '../layout/loading-indicator/loading-indicator.component';
import { ApiService, Cat21PaginatedResult } from '../openapi-client';


@Component({
  selector: 'app-start',
  templateUrl: './start.component.html',
  styleUrls: ['./start.component.scss'],
  standalone: true,
  imports: [
    LoadingIndicatorComponent,
    LoadingIndicatorButtonComponent,
    AlertComponent,
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

  defaultItemsPerPage = 12;
  catsPaginated$: Observable<Cat21PaginatedResult> = of(
    this.emptyResult(
      this.defaultItemsPerPage,
      this.defaultItemsPerPage,
      1)
  );

  constructor(private api: ApiService) {
    this.loadCats(
      this.defaultItemsPerPage,
      this.defaultItemsPerPage,
      1)
  }

  emptyResult(totalResults: number, itemsPerPage: number, currentPage: number) {
    return {
      cats: new Array(itemsPerPage), // array with x times undefined, which renders the "Loading..." text
      totalResults,
      itemsPerPage,
      currentPage,
    }
  }

  loadCats(totalResults: number, itemsPerPage: number, currentPage: number) {
    this.catsPaginated$ = this.api.cats(itemsPerPage, currentPage).pipe(
      retry({
        count: 2,
        delay: 1000
      }),
      startWith(this.emptyResult(totalResults, itemsPerPage, currentPage))
    );
  }
}
