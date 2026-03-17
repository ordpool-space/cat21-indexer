import { AsyncPipe, NgIf } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, Observable, of, retry, shareReplay, startWith, switchMap } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService, CatDto, StatusDto } from '../openapi-client';

@Component({
  selector: 'app-details',
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss'],
  standalone: true,
  imports: [NgIf, RouterLink, Cat21ViewerComponent, AsyncPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailsComponent {
  private api = inject(ApiService);

  catNumber$ = inject(ActivatedRoute).paramMap.pipe(
    map((paramMap) => parseInt(paramMap.get('catNumber') || '0', 10)),
  );

  status$: Observable<StatusDto | null> = this.api.catsControllerGetStatus().pipe(
    retry({ count: 3, delay: 1000 }),
    catchError(() => of(null)),
    shareReplay(1),
  );

  cat$: Observable<CatDto | null> = this.catNumber$.pipe(
    switchMap((catNumber) =>
      this.api.catsControllerGetCatByNumber(catNumber).pipe(
        startWith(null),
        retry({ count: 3, delay: 1000 }),
        catchError((err: HttpErrorResponse) => of(null)),
      ),
    ),
  );
}
