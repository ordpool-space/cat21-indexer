import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Cat21AcceptOfferOrchestrator,
  Cat21OfferRejectionReason,
  WalletService,
} from 'ordpool-sdk';

import { CatUtxoLookupService, MyCatHolding } from '../../../shared/cat-utxo-lookup.service';
import { rxResourceFixed } from '../../../shared/rx-resource-fixed';
import { WalletConnect } from '../../../shared/wallet-connect/wallet-connect';

@Component({
  selector: 'app-accept-offer',
  templateUrl: './accept-offer.html',
  styleUrl: './accept-offer.scss',
  imports: [DecimalPipe, RouterLink, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptOffer implements OnInit {
  private orchestrator = inject(Cat21AcceptOfferOrchestrator);
  private walletService = inject(WalletService);
  private lookup = inject(CatUtxoLookupService);
  private route = inject(ActivatedRoute);

  readonly txLinkBase = 'https://ordpool.space/tx/';

  // ---------- Live state from the orchestrator ----------

  readonly connectedWallet = this.orchestrator.connectedWallet;
  readonly state = this.orchestrator.state;
  readonly errorMessage = this.orchestrator.errorMessage;
  readonly successTxId = this.orchestrator.successTxId;
  readonly parsedOffer = this.orchestrator.parsedOffer;
  readonly validationResult = this.orchestrator.validationResult;
  readonly pastedOffer = this.orchestrator.pastedOffer;
  readonly expectedCatUtxo = this.orchestrator.expectedCatUtxo;
  readonly floorPriceSats = this.orchestrator.floorPriceSats;
  readonly canAccept = this.orchestrator.canAccept;

  // ---------- Cat picker + local form state ----------

  /**
   * Connected wallet bridged to a signal for the holdings resource params.
   */
  private readonly walletSignal = toSignal(this.walletService.connectedWallet$, { initialValue: null });

  /**
   * Resource that fetches the seller's current cat holdings the moment a
   * wallet connects. Drives the "which of your cats is this offer for"
   * picker so the seller doesn't paste txid:vout by hand.
   */
  readonly holdingsResource = rxResourceFixed({
    params: () => ({ ordinalsAddress: this.walletSignal()?.ordinalsAddress ?? null }),
    stream: ({ params }) =>
      params.ordinalsAddress ? this.lookup.getMyHoldings(params.ordinalsAddress) : EMPTY,
  });

  readonly myHoldings = computed<readonly MyCatHolding[]>(() => this.holdingsResource.value() ?? []);

  readonly selectedInscriptionId = signal<string | null>(null);

  readonly selectedHolding = computed<MyCatHolding | null>(() => {
    const id = this.selectedInscriptionId();
    if (!id) return null;
    return this.myHoldings().find((h) => h.inscriptionId === id) ?? null;
  });

  readonly floorPriceInput = signal<string>('');

  readonly humanRejection = computed<string | null>(() => {
    const v = this.validationResult();
    if (!v || v.ok) return null;
    return rejectionToHuman(v.reason, v.detail);
  });

  // ---------- Lifecycle ----------

  constructor() {
    // When the seller picks a cat from the dropdown, push it to the
    // orchestrator so its validation knows which cat the pasted offer
    // must reference. The seller's payment address auto-fills too —
    // the wallet's ordinals address is the seller's ordinals address,
    // which is where the cat lives and where the funds come back to
    // (per the ord-style offer protocol).
    effect(() => {
      const h = this.selectedHolding();
      const wallet = this.walletSignal();
      if (!h) {
        this.orchestrator.setExpectedCatUtxo(null);
        return;
      }
      this.orchestrator.setExpectedCatUtxo({ txid: h.txid, vout: h.vout });
      if (wallet) {
        // Seller's "payment" output goes to whichever address the
        // seller wants their BTC. Default to their connected wallet's
        // payment address (the typical case); the buyer's offer
        // builds the seller-payment-output against this address.
        this.orchestrator.setExpectedSellerPaymentAddress(wallet.paymentAddress);
      }
    });
  }

  ngOnInit(): void {
    // Auto-fill from ?offer=… so a buyer can hand the seller a one-click link.
    const offerParam = this.route.snapshot.queryParamMap.get('offer');
    if (offerParam) {
      this.orchestrator.setPastedOffer(offerParam);
    }
  }

  // ---------- Commands ----------

  onPasteChange(value: string): void {
    this.orchestrator.setPastedOffer(value);
  }

  onCatPick(inscriptionId: string): void {
    this.selectedInscriptionId.set(inscriptionId || null);
  }

  onFloorPriceChange(value: string): void {
    this.floorPriceInput.set(value);
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n >= 0) {
      this.orchestrator.setFloorPriceSats(n);
    }
  }

  onAcceptClick(): void {
    this.orchestrator.acceptOffer().subscribe({
      error: () => undefined,
    });
  }

  onResetClick(): void {
    this.orchestrator.reset();
    this.selectedInscriptionId.set(null);
    this.floorPriceInput.set('');
    this.holdingsResource.reload();
  }
}

function rejectionToHuman(reason: Cat21OfferRejectionReason, detail?: string): string {
  switch (reason) {
    case 'missing-seller-input':
      return `The offer's input 0 doesn't reference your cat. ${detail ?? ''}`.trim();
    case 'wrong-postage':
      return `The cat output postage is wrong (expected 546 sats). ${detail ?? ''}`.trim();
    case 'wrong-price':
      return `The seller-payment output is below your floor price. ${detail ?? ''}`.trim();
    case 'sighash-not-all':
      return `The offer commits with a sighash other than SIGHASH_ALL — not accepting that. ${detail ?? ''}`.trim();
    case 'buyer-input-unsigned':
      return `The buyer hasn't signed all their funding inputs yet. ${detail ?? ''}`.trim();
    case 'missing-seller-payment-output':
      return `The offer's payment output is missing. ${detail ?? ''}`.trim();
    case 'payment-output-wrong-address':
      return `The seller-payment output is going to a different address than expected. ${detail ?? ''}`.trim();
    default:
      return `Rejected: ${reason} ${detail ?? ''}`.trim();
  }
}
