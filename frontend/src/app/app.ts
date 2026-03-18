import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

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
}
