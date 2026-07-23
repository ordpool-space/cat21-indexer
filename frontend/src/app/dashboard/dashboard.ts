import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { WalletService } from 'ordpool-sdk';

import { WalletConnect } from '../shared/wallet-connect/wallet-connect';

interface DashboardCard {
  title: string;
  description: string;
  /** Either an in-app routerLink target or an external URL. */
  link: string;
  external?: boolean;
  status: 'active' | 'soon';
  /** kebab-case discriminator used to build the E2E data-testid. */
  testId: string;
}

/**
 * Dashboard hub for the connected user. Lists workspace tools as
 * pixel-themed cards. New tools land here as soon as they have a
 * /dashboard/<slug> route, even if the page is just a "coming soon"
 * placeholder.
 *
 * Gated on a connected wallet — disconnected visitors see a CTA card
 * that reuses the wallet-connect component (same modal, same code path
 * as the header). Reactively flips back to the hub when a wallet
 * connects.
 */
@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  imports: [RouterLink, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private walletService = inject(WalletService);

  readonly wallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });

  readonly shortAddress = computed(() => {
    const addr = this.wallet()?.ordinalsAddress ?? '';
    return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
  });

  readonly cards: readonly DashboardCard[] = [
    {
      title: 'My cats',
      description: 'See the cats your wallet currently holds, with rarity and traits.',
      link: '/dashboard/cats',
      status: 'active',
      testId: 'my-cats',
    },
    {
      title: 'Mint a cat',
      description: 'Lock a new cat to a Bitcoin sat. Image generated deterministically once the tx confirms.',
      link: '/dashboard/mint',
      status: 'active',
      testId: 'mint',
    },
    {
      title: 'Transfer a cat',
      description: 'Send one of your cats to another address. nLockTime=21 preserved through the transfer, so the cat mints a fresh block-21 marker on arrival.',
      link: '/dashboard/transfer',
      status: 'active',
      testId: 'transfer',
    },
    {
      title: 'Trade a cat',
      description: 'Sniping-proof PSBT offers, ord-style. Buyer builds + signs, seller countersigns input 0, tx broadcasts, cat + payment settle in one block.',
      link: '/dashboard/trade',
      status: 'active',
      testId: 'trade',
    },
  ];
}
