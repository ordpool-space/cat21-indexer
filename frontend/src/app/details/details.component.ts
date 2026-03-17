import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, filter, fromEvent, map, Observable, of, retry, shareReplay, startWith, switchMap, withLatestFrom } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService, CatDto, StatusDto } from '../openapi-client';

export interface CatState {
  cat: CatDto | null;
  loading: boolean;
  error: boolean;
}

@Component({
    selector: 'app-details',
    templateUrl: './details.component.html',
    styleUrls: ['./details.component.scss'],
    imports: [RouterLink, Cat21ViewerComponent, AsyncPipe],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DetailsComponent {
  private api = inject(ApiService);
  private router = inject(Router);

  catNumber$ = inject(ActivatedRoute).paramMap.pipe(
    map((paramMap) => parseInt(paramMap.get('catNumber') || '0', 10)),
  );

  status$: Observable<StatusDto | null> = this.api.catsControllerGetStatus().pipe(
    retry({ count: 3, delay: 1000 }),
    catchError(() => of(null)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  catState$: Observable<CatState> = this.catNumber$.pipe(
    switchMap((catNumber) =>
      this.api.catsControllerGetCatByNumber(catNumber).pipe(
        map((cat) => ({ cat, loading: false, error: false }) as CatState),
        retry({ count: 3, delay: 1000 }),
        catchError(() => of({ cat: null, loading: false, error: true } as CatState)),
        startWith({ cat: null, loading: true, error: false } as CatState),
      ),
    ),
  );

  constructor() {
    fromEvent<KeyboardEvent>(window, 'keydown').pipe(
      filter((e) => e.key === 'ArrowLeft' || e.key === 'ArrowRight'),
      withLatestFrom(this.catNumber$, this.status$),
      takeUntilDestroyed(),
    ).subscribe(([event, catNumber, status]) => {
      if (event.key === 'ArrowLeft' && status && catNumber < status.lastSyncedCatNumber) {
        this.router.navigate(['/cat', catNumber + 1]);
      }
      if (event.key === 'ArrowRight' && catNumber > 0) {
        this.router.navigate(['/cat', catNumber - 1]);
      }
    });
  }
}
