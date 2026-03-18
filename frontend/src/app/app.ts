import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';

import { Header } from './layout/header/header';
import { RoutingStateService } from './services/routing-state.service';

@Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'body',
    templateUrl: './app.html',
    styleUrl: './app.scss',
    imports: [
        Header,
        RouterOutlet,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class App {
  smallHeader = inject(RoutingStateService).smallHeader;
  private mainRef = viewChild.required<ElementRef<HTMLElement>>('mainRef');

  constructor() {
    inject(Router).events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      skip(1),
      takeUntilDestroyed(),
    ).subscribe(() => {
      this.mainRef().nativeElement.focus({ preventScroll: true });
    });
  }
}
