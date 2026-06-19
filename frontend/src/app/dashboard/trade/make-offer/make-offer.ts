import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { hex } from '@scure/base';
import {
  BuyOfferTargetCat,
  Cat21CreateOfferOrchestrator,
  CreateOfferSimulationOutcome,
} from 'ordpool-sdk';

import { FeesPicker } from '../../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../../shared/wallet-connect/wallet-connect';

interface MakeOfferDraft {
  catNumberInput: string;
  catOutpointInput: string;
  sellerScriptHexInput: string;
  sellerPaymentAddressInput: string;
  priceSatsInput: string;
}

@Component({
  selector: 'app-make-offer',
  templateUrl: './make-offer.html',
  styleUrl: './make-offer.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MakeOffer {
  private orchestrator = inject(Cat21CreateOfferOrchestrator);

  // ---------- Live state from the orchestrator ----------

  readonly connectedWallet = this.orchestrator.connectedWallet;
  readonly state = this.orchestrator.state;
  readonly errorMessage = this.orchestrator.errorMessage;
  readonly offerArtifact = this.orchestrator.offerArtifact;
  readonly feeRate = this.orchestrator.feeRate;
  readonly targetCat = this.orchestrator.targetCat;
  readonly sellerPaymentAddress = this.orchestrator.sellerPaymentAddress;
  readonly priceSats = this.orchestrator.priceSats;
  readonly buyerReceiveAddress = this.orchestrator.buyerReceiveAddress;

  readonly simulationOutcome = toSignal<CreateOfferSimulationOutcome | null>(
    this.orchestrator.simulation$,
    { initialValue: null },
  );

  // ---------- Local form state ----------

  readonly draft = signal<MakeOfferDraft>({
    catNumberInput: '',
    catOutpointInput: '',
    sellerScriptHexInput: '',
    sellerPaymentAddressInput: '',
    priceSatsInput: '',
  });

  readonly parsedOutpoint = computed<{ txid: string; vout: number } | null>(() => {
    const raw = this.draft().catOutpointInput.trim();
    if (!raw) return null;
    const m = raw.match(/^([0-9a-fA-F]{64})\s*:\s*(\d+)$/);
    if (!m) return null;
    return { txid: m[1].toLowerCase(), vout: Number.parseInt(m[2], 10) };
  });

  readonly canCreateOffer = computed(() => {
    if (this.state() !== 'ready') return false;
    if (!this.targetCat()) return false;
    if (!this.sellerPaymentAddress()) return false;
    if (!this.priceSats()) return false;
    if (!this.feeRate()) return false;
    const outcome = this.simulationOutcome();
    return !!outcome && !outcome.insufficient && !!outcome.simulation;
  });

  /** Direct link the buyer hands the seller; auto-fills the accept page. */
  readonly shareableUrl = computed<string | null>(() => {
    const art = this.offerArtifact();
    if (!art) return null;
    return `${window.location.origin}/dashboard/trade/accept?offer=${encodeURIComponent(art.base64)}`;
  });

  // ---------- Commands ----------

  onCatNumberChange(value: string): void {
    this.draft.update((d) => ({ ...d, catNumberInput: value }));
    this.pushTargetCat();
  }

  onCatOutpointChange(value: string): void {
    this.draft.update((d) => ({ ...d, catOutpointInput: value }));
    this.pushTargetCat();
  }

  onSellerScriptHexChange(value: string): void {
    this.draft.update((d) => ({ ...d, sellerScriptHexInput: value }));
    this.pushTargetCat();
  }

  onSellerPaymentAddressChange(value: string): void {
    this.draft.update((d) => ({ ...d, sellerPaymentAddressInput: value }));
    this.orchestrator.setSellerPaymentAddress(value);
  }

  onPriceSatsChange(value: string): void {
    this.draft.update((d) => ({ ...d, priceSatsInput: value }));
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) {
      this.orchestrator.setPriceSats(n);
    }
  }

  onCreateOfferClick(): void {
    this.orchestrator.createOffer().subscribe({
      error: () => undefined,
    });
  }

  onCopyArtifactClick(): void {
    const art = this.offerArtifact();
    if (!art) return;
    navigator.clipboard?.writeText(art.base64).catch(() => undefined);
  }

  onCopyShareableUrlClick(): void {
    const url = this.shareableUrl();
    if (!url) return;
    navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  onResetClick(): void {
    this.orchestrator.reset();
    this.draft.set({
      catNumberInput: '',
      catOutpointInput: '',
      sellerScriptHexInput: '',
      sellerPaymentAddressInput: '',
      priceSatsInput: '',
    });
  }

  // ---------- Internals ----------

  /**
   * Push the current outpoint + script + cat-number to the orchestrator
   * as a BuyOfferTargetCat. Requires all three to be valid; otherwise
   * clears the orchestrator's target.
   */
  private pushTargetCat(): void {
    const parsed = this.parsedOutpoint();
    const scriptHex = this.draft().sellerScriptHexInput.trim();
    if (!parsed || !scriptHex) {
      this.orchestrator.setTargetCat(null);
      return;
    }
    let scriptBytes: Uint8Array;
    try {
      scriptBytes = hex.decode(scriptHex.toLowerCase());
    } catch {
      this.orchestrator.setTargetCat(null);
      return;
    }
    const catNum = Number.parseInt(this.draft().catNumberInput, 10);
    const target: BuyOfferTargetCat = {
      catNumber: Number.isFinite(catNum) ? catNum : -1,
      txid: parsed.txid,
      vout: parsed.vout,
      value: 546,
      scriptPubKey: scriptBytes,
    };
    this.orchestrator.setTargetCat(target);
  }
}
