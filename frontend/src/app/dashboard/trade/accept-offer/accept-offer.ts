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

  /**
   * Cat outpoint the URL-shareable accept link supplied. When the
   * buyer's reply link is `/dashboard/trade/accept?offer=…&catTxid=…&catVout=…`,
   * the seller doesn't have to pick — the outpoint is already known
   * from the offer PSBT's input 0 and can be committed in the URL.
   * Falls back to the picker when either param is missing or when the
   * seller wants to double-check by picking manually.
   */
  readonly urlCatOutpoint = signal<{ txid: string; vout: number } | null>(null);

  readonly floorPriceInput = signal<string>('');

  readonly humanRejection = computed<string | null>(() => {
    const v = this.validationResult();
    if (!v || v.ok) return null;
    return rejectionToHuman(v.reason, v.detail);
  });

  // ---------- Lifecycle ----------

  /** Audit M5 — wallet-swap form reset. See transfer.ts for the rationale. */
  private lastSeenOrdinalsAddress: string | null = null;

  constructor() {
    // When the seller picks a cat from the dropdown, push it to the
    // orchestrator so its validation knows which cat the pasted offer
    // must reference. The seller's payment address auto-fills too —
    // the wallet's ordinals address is the seller's ordinals address,
    // which is where the cat lives and where the funds come back to
    // (per the ord-style offer protocol).
    effect(() => {
      const fromPicker = this.selectedHolding();
      const fromUrl = this.urlCatOutpoint();
      const wallet = this.walletSignal();
      // Picker takes precedence when the seller has actively picked
      // a cat. URL-supplied outpoint is the fallback so a one-click
      // accept-link from the buyer doesn't require picking anything.
      if (fromPicker) {
        this.orchestrator.setExpectedCatUtxo({ txid: fromPicker.txid, vout: fromPicker.vout });
      } else if (fromUrl) {
        this.orchestrator.setExpectedCatUtxo(fromUrl);
      } else {
        this.orchestrator.setExpectedCatUtxo(null);
      }
      if (wallet) {
        // Seller's "payment" output goes to whichever address the
        // seller wants their BTC. Default to their connected wallet's
        // payment address (the typical case); the buyer's offer
        // builds the seller-payment-output against this address.
        this.orchestrator.setExpectedSellerPaymentAddress(wallet.paymentAddress);
      }
    });

    // Wallet-swap form reset (audit M5).
    effect(() => {
      const w = this.walletSignal();
      const current = w?.ordinalsAddress ?? null;
      if (this.lastSeenOrdinalsAddress === null) {
        this.lastSeenOrdinalsAddress = current;
        return;
      }
      if (this.lastSeenOrdinalsAddress === current) return;
      this.lastSeenOrdinalsAddress = current;
      this.selectedInscriptionId.set(null);
      this.floorPriceInput.set('');
      // pastedOffer / parsedOffer are owned by the orchestrator's own
      // wallet-change reset (Cat21AcceptOfferOrchestrator).
    });

    // NOTE: parsedOffer only fires once validation succeeds, and
    // validation requires floor to be set first — chicken-and-egg for
    // the URL flow. Instead, ngOnInit sets floor=0 explicitly when the
    // URL brings all three (offer, catTxid, catVout) — the seller has
    // already consented to the price by clicking through the buyer's
    // link, so the audit-H2 forgot-my-floor safety-net is irrelevant.
    // Manual-paste flows still require the seller to type a floor.
  }

  ngOnInit(): void {
    // Auto-fill from ?offer=… so a buyer can hand the seller a one-click link.
    const params = this.route.snapshot.queryParamMap;
    const offerParam = params.get('offer');
    // Optional catTxid + catVout — the buyer's reply link commits the
    // cat outpoint the offer targets, so the seller doesn't need to
    // pick manually. Both required to take effect.
    const catTxid = params.get('catTxid');
    const catVoutRaw = params.get('catVout');
    let urlBroughtFullOfferBundle = false;
    if (catTxid && catVoutRaw) {
      const vout = Number.parseInt(catVoutRaw, 10);
      if (/^[0-9a-f]{64}$/i.test(catTxid) && Number.isFinite(vout) && vout >= 0) {
        this.urlCatOutpoint.set({ txid: catTxid.toLowerCase(), vout });
        urlBroughtFullOfferBundle = !!offerParam;
      }
    }
    // Order matters: floor must be set BEFORE setPastedOffer triggers
    // validation (validation reads floor sync). The URL one-click flow
    // sets floor=0 — the seller consented by clicking a link with the
    // buyer's already-committed price; the summary panel still shows
    // pricePaidSats before signing, so the human is the final gate.
    if (urlBroughtFullOfferBundle) {
      this.floorPriceInput.set('0');
      this.orchestrator.setFloorPriceSats(0);
    }
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
