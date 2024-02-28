import { AsyncPipe, JsonPipe, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { BannerComponent } from './layout/banner/banner.component';
import { FooterComponent } from './layout/footer/footer.component';
import { HeaderComponent } from './layout/header/header.component';
import { RoutingStateService } from './services/routing-state.service';

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
  smallHeader$ = inject(RoutingStateService).smallHeader$;
  testnet$ = inject(RoutingStateService).testnet$;
}
