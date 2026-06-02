import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { WalletService } from 'ordpool-sdk';

import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

@Component({
  templateUrl: './header.html',
  styleUrl: './header.scss',
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'header',
  imports: [RouterLink, NgOptimizedImage, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Header {
  readonly smallHeader = input<boolean | null>(false);

  private walletService = inject(WalletService);
  // Surfaced to the template purely so the "My cats" link can show/hide
  // based on connection state. Same BehaviorSubject the wallet-connect
  // popover subscribes to.
  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
}
