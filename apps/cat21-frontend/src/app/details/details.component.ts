import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, combineLatest, forkJoin, map, of, retry, startWith, switchMap, tap, withLatestFrom } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { LoadingIndicatorComponent } from '../layout/loading-indicator/loading-indicator.component';
import { ApiService, Cat21SingleResult, Cat21SingleResultCat, TestnetApiService } from '../openapi-client';
import { RoutingStateService } from '../services/routing-state.service';


@Component({
  selector: 'app-details',
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss'],
  standalone: true,
  imports: [
    LoadingIndicatorComponent,
    NgIf,
    RouterLink,
    NgFor,
    Cat21ViewerComponent,
    AsyncPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DetailsComponent {

  private api = inject(ApiService);
  private testnetApi = inject(TestnetApiService);

  transactionId$ = inject(ActivatedRoute).paramMap.pipe(
    map(paramMap => paramMap.get('transactionId') ?? ''),
  );

  testnet$ = inject(ActivatedRoute).data.pipe(
    map(data => !!data.testnet),
  );


  cat$: Observable<Cat21SingleResult | null> = combineLatest([
    this.transactionId$,
    this.testnet$
  ]).pipe(
    switchMap(([transactionId, isTestnet]) => {

      let api: Observable<Cat21SingleResult>;

      if (!isTestnet) {
        api = this.api.cat(transactionId);
      } else {
        api = this.testnetApi.testnetCat(transactionId);
      }

      return api.pipe(
        startWith(null),
        retry({
          count: 3,
          delay: 1000
        }),
        catchError((err: HttpErrorResponse) => of(null))
      )
    }
    )
  )
}
