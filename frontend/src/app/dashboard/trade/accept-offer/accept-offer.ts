import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Cat21AcceptOfferOrchestrator,
  Cat21OfferRejectionReason,
} from 'ordpool-sdk';

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

  // ---------- Local form state ----------

  readonly catOutpointInput = signal<string>('');
  readonly floorPriceInput = signal<string>('');

  readonly parsedCatOutpoint = computed<{ txid: string; vout: number } | null>(() => {
    const raw = this.catOutpointInput().trim();
    if (!raw) return null;
    const m = raw.match(/^([0-9a-fA-F]{64})\s*:\s*(\d+)$/);
    if (!m) return null;
    return { txid: m[1].toLowerCase(), vout: Number.parseInt(m[2], 10) };
  });

  readonly humanRejection = computed<string | null>(() => {
    const v = this.validationResult();
    if (!v || v.ok) return null;
    return rejectionToHuman(v.reason, v.detail);
  });

  // ---------- Lifecycle ----------

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

  onCatOutpointChange(value: string): void {
    this.catOutpointInput.set(value);
    const parsed = this.parsedCatOutpoint();
    this.orchestrator.setExpectedCatUtxo(parsed);
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
    this.catOutpointInput.set('');
    this.floorPriceInput.set('');
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
