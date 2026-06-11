import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { WalletService } from 'ordpool-sdk';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { OrdApiService } from '../shared/ord-api.service';
import { PendingCats } from '../shared/pending-cats/pending-cats';
import { rxResourceFixed } from '../shared/rx-resource-fixed';
import { WalletConnect } from '../shared/wallet-connect/wallet-connect';

/**
 * Dashboard view for the connected wallet's cats. The data path mirrors
 * the /address/:address page — ord knows where every sat currently
 * lives, so we ask it directly for the cats at the connected wallet's
 * ordinals (taproot) address. Cat-sat ownership is the only ground
 * truth; the cat21-indexer DB doesn't track current ownership.
 *
 * When no wallet is connected we render a CTA card that wraps the
 * existing wallet-connect button — same code path as the header.
 */
@Component({
  selector: 'app-my-cats',
  templateUrl: './my-cats.html',
  styleUrl: './my-cats.scss',
  imports: [CatGallery, PendingCats, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyCats {
  private walletService = inject(WalletService);
  private ordApi = inject(OrdApiService);

  readonly env = environment;
  readonly wallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
  readonly ordinalsAddress = computed<string | null>(() => this.wallet()?.ordinalsAddress ?? null);

  catsResource = rxResourceFixed({
    params: () => ({ address: this.ordinalsAddress() }),
    stream: ({ params }) =>
      params.address ? this.ordApi.getAddress(params.address) : EMPTY,
  });

  catNumbers = computed(() => this.catsResource.value()?.cat_numbers ?? []);
}
