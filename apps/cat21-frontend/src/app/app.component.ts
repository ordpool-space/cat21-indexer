import { AsyncPipe, JsonPipe, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';

import { BannerComponent } from './layout/banner/banner.component';
import { FooterComponent } from './layout/footer/footer.component';
import { HeaderComponent } from './layout/header/header.component';
import { filter, map, switchMap } from 'rxjs';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'body',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: true,
  imports: [
    BannerComponent,
    FooterComponent,
    HeaderComponent,
    RouterOutlet,
    NgIf,
    AsyncPipe,
    JsonPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {

  router = inject(Router);

  smallHeader$ = this.router.events.pipe(
    filter((event: any) => event instanceof NavigationEnd),
    switchMap(() => {
      let route = this.router.routerState.root;
      while (route.firstChild) {
        route = route.firstChild;
      }
      return route.data;
    }),
    map(data => !!data.smallHeader)
  );
}
