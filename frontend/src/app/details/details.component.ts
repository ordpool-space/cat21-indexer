import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { rxResourceFixed } from '../shared/utils/rx-resource-fixed';
import { map } from 'rxjs';

import { Cat21ViewerComponent } from '../cat21-viewer/cat21-viewer.component';
import { ApiService } from '../openapi-client';

@Component({
    selector: 'app-details',
    templateUrl: './details.component.html',
    styleUrls: ['./details.component.scss'],
    imports: [RouterLink, Cat21ViewerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
      '(window:keydown.ArrowLeft)': 'navigateNewer()',
      '(window:keydown.ArrowRight)': 'navigateOlder()',
    }
})
export class DetailsComponent {
  private api = inject(ApiService);
  private router = inject(Router);

  catNumber = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((paramMap) => parseInt(paramMap.get('catNumber') || '0', 10)),
    ),
    { initialValue: 0 }
  );

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
