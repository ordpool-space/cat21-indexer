import { inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, switchMap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class RoutingStateService {
  private router = inject(Router);

  private navigation$ = this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    switchMap(() => {
      let route = this.router.routerState.root;
      while (route.firstChild) {
        route = route.firstChild;
      }
      return route.data;
    })
  );

  smallHeader = toSignal(
    this.navigation$.pipe(map(data => !!data['smallHeader'])),
    { initialValue: false }
  );
}
