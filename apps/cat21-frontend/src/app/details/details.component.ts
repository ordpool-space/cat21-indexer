import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LetModule } from '@rx-angular/template/let';
import { PushModule } from '@rx-angular/template/push';

import { environment } from '../../environments/environment';
import { LoadingIndicatorComponent } from '../layout/loading-indicator/loading-indicator.component';
import { ShortenAddressPipe } from '../layout/shorten-address.pipe';
import { NoSanitizePipe } from '../no-sanitize.pipe';
import { MintFacade } from '../store/mint.facade';

@Component({
  selector: 'app-details',
  templateUrl: './details.component.html',
  styleUrls: ['./details.component.scss'],
  standalone: true,
  imports: [
    LoadingIndicatorComponent,
    NgIf,
    RouterLink,
    NoSanitizePipe,
    LetModule,
    PushModule,
    NgFor,
    ShortenAddressPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DetailsComponent {
  mintFacade = inject(MintFacade);
  environment = environment;

  getIframeSrc(inscriptionId?: string | undefined): string {
    if (!inscriptionId) {
      return 'about:blank';
    }
    return environment.ordinalsExplorerIframe + inscriptionId + '?cache-buster';
  }
}
