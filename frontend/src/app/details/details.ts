import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Cat21Viewer } from '../cat21-viewer/cat21-viewer';
import { ApiService } from '../shared/cat21-api';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [RouterLink, Cat21Viewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown.ArrowLeft)': 'navigateNewer()',
    '(window:keydown.ArrowRight)': 'navigateOlder()',
  }
})
export class Details {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly catNumber = input(0, { transform: numberAttribute });

  catResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.api.catsControllerGetCatByNumber(params.catNumber),
  });

  statusResource = rxResourceFixed({
    stream: () => this.api.catsControllerGetStatus(),
  });

  lastSynced = computed(() => this.statusResource.value()?.lastSyncedCatNumber ?? 0);

  navigateNewer() {
    const n = this.catNumber();
    if (n < this.lastSynced()) {
      this.router.navigate(['/cat', n + 1]);
    }
  }

  navigateOlder() {
    const n = this.catNumber();
    if (n > 0) {
      this.router.navigate(['/cat', n - 1]);
    }
  }
}
