import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, map, of, retry, startWith, switchMap } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { LoadingIndicatorComponent } from '../layout/loading-indicator/loading-indicator.component';
import { ApiService, Cat21SingleResult, Cat21SingleResultCat } from '../openapi-client';


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

  cat$: Observable<Cat21SingleResult | null> = inject(ActivatedRoute).paramMap.pipe(
    map(paramMap => paramMap.get('transactionId') ?? ''),
    switchMap(transactionId => this.api.cat(transactionId).pipe(
      startWith(null),
      retry({
        count: 3,
        delay: 1000
      }),
      catchError((err: HttpErrorResponse) => of(null))
    ))
  )
}
