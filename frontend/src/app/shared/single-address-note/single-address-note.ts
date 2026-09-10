import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { singleAddressCaveat, usesSingleAddress, WalletService } from 'ordpool-sdk';

/**
 * A calm, info-register note about single-address custody, shown beside a
 * cat-acquiring action (mint, make-offer) when the CONNECTED wallet hands out
 * ONE address for both the ordinals and the payment role.
 *
 * It is information, not a warning: no icon, no amber, no `role="alert"`, no
 * dismiss button. It states why a dedicated address helps and how to get one.
 * The copy is SDK-owned (`singleAddressCaveat`) so cat21.space, ordpool.space
 * and cubes can't drift.
 *
 * Placement is by cat direction (round-3): shown where the connected wallet
 * ENDS UP HOLDING a cat — mint, and the buyer side of an offer — never where
 * the cat leaves (transfer, accept-offer-as-seller). Driven by the SDK's
 * `usesSingleAddress`, which compares the two addresses the wallet actually
 * returned (ground truth), so it stays right whatever a wallet's model.
 */
@Component({
  selector: 'app-single-address-note',
  templateUrl: './single-address-note.html',
  styleUrl: './single-address-note.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SingleAddressNote {
  private walletService = inject(WalletService);
  private readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });

  readonly isSingleAddress = computed<boolean>(() => usesSingleAddress(this.connectedWallet()));

  /** SDK-owned copy, cats-worded for this site. Full sentences, info register. */
  readonly note = singleAddressCaveat('cats');
}
