import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { HeaderComponent } from './layout/header/header.component';
import { RoutingStateService } from './services/routing-state.service';

@Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'body',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    imports: [
        HeaderComponent,
        RouterOutlet,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  smallHeader = inject(RoutingStateService).smallHeader;
}
