import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { WalletService } from 'ordpool-sdk';

import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

@Component({
  templateUrl: './header.html',
  styleUrl: './header.scss',
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'header',
  imports: [RouterLink, RouterLinkActive, NgOptimizedImage, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Header {
  readonly smallHeader = input<boolean | null>(false);

  private walletService = inject(WalletService);
  // Surfaced to the template purely so the "My cats" link can show/hide
  // based on connection state. Same BehaviorSubject the wallet-connect
  // popover subscribes to.
  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });

  /**
   * Mobile nav dropdown state. Below the burger breakpoint the nav links + the
   * connect control collapse behind a hamburger; this toggles that panel. It is
   * inert on desktop, where the links are always shown inline (CSS decides
   * which layout applies), so it can stay open harmlessly across a resize.
   */
  readonly menuOpen = signal(false);
  toggleMenu(): void { this.menuOpen.update((open) => !open); }
  closeMenu(): void { this.menuOpen.set(false); }
}
