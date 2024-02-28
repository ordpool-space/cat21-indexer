import { inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, switchMap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class RoutingStateService {

  router = inject(Router);

  navigation$ = this.router.events.pipe(
    filter((event: any) => event instanceof NavigationEnd),
    switchMap(() => {
      let route = this.router.routerState.root;
      while (route.firstChild) {
        route = route.firstChild;
      }
      return route.data;
    })
  );

  smallHeader$ = this.navigation$.pipe(
    map(data => !!data.smallHeader)
  );
}
