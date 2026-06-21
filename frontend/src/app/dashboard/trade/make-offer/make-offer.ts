import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  BuyOfferTargetCat,
  Cat21CreateOfferOrchestrator,
  CreateOfferSimulationOutcome,
} from 'ordpool-sdk';

import { CatUtxoLookupService } from '../../../shared/cat-utxo-lookup.service';
import { FeesPicker } from '../../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../../shared/wallet-connect/wallet-connect';

interface MakeOfferDraft {
  catNumberInput: string;
  sellerPaymentAddressInput: string;
  priceSatsInput: string;
}

type LookupState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-make-offer',
  templateUrl: './make-offer.html',
  styleUrl: './make-offer.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MakeOffer {
  private orchestrator = inject(Cat21CreateOfferOrchestrator);
  private lookup = inject(CatUtxoLookupService);

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
    sellerPaymentAddressInput: '',
    priceSatsInput: '',
  });

  /** State of the cat-number → on-chain location lookup. */
  readonly lookupState = signal<LookupState>('idle');
  readonly lookupError = signal<string | null>(null);
  readonly resolvedSellerAddress = signal<string | null>(null);

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

  /** Audit M5 — wallet-swap form reset. See transfer.ts for the rationale. */
  private lastSeenOrdinalsAddress: string | null = null;

  constructor() {
    effect(() => {
      const w = this.connectedWallet();
      const current = w?.ordinalsAddress ?? null;
      if (this.lastSeenOrdinalsAddress === null) {
        this.lastSeenOrdinalsAddress = current;
        return;
      }
      if (this.lastSeenOrdinalsAddress === current) return;
      this.lastSeenOrdinalsAddress = current;
      // Wallet swapped — clear local form fields the orchestrator doesn't own.
      this.draft.set({
        catNumberInput: '',
        sellerPaymentAddressInput: '',
        priceSatsInput: '',
      });
      this.lookupState.set('idle');
      this.lookupError.set(null);
      this.resolvedSellerAddress.set(null);
      this.lookupRequestId++; // invalidate any in-flight response
    });
  }

  // ---------- Commands ----------

  /**
   * Request-id token for the in-flight lookup. When the user edits the
   * input mid-flight, we bump this counter — late-arriving responses
   * for the OLD request find their token doesn't match and silently
   * drop. Audit finding H3.
   */
  private lookupRequestId = 0;

  /**
   * Look up the cat by number against cat21-indexer + ord. Auto-fills:
   *   - the orchestrator's `targetCat` (txid, vout, value, scriptPubKey)
   *   - the seller-payment-address input (the cat's current owner)
   *
   * Idempotent — re-running with the same number rebuilds against the
   * latest on-chain state.
   */
  onLookupCatClick(): void {
    const raw = this.draft().catNumberInput.trim();
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      this.lookupError.set('Cat number must be a non-negative integer.');
      this.lookupState.set('error');
      return;
    }
    // Bump the request token; any in-flight response with a stale token
    // will land in next() below and be dropped without touching state.
    const myToken = ++this.lookupRequestId;
    this.lookupState.set('loading');
    this.lookupError.set(null);
    this.orchestrator.setTargetCat(null);
    this.resolvedSellerAddress.set(null);
    this.lookup.getTargetByNumber(n).subscribe({
      next: (result) => {
        if (myToken !== this.lookupRequestId) return; // stale response
        if (!result) {
          this.lookupError.set('Cat not found on ord, OR ord vs electrs disagree on the seller address (potential oracle inconsistency).');
          this.lookupState.set('error');
          return;
        }
        this.orchestrator.setTargetCat(result.target);
        this.resolvedSellerAddress.set(result.sellerAddress);
        // Auto-fill seller payment address to the resolved owning address.
        this.draft.update((d) => ({ ...d, sellerPaymentAddressInput: result.sellerAddress }));
        this.orchestrator.setSellerPaymentAddress(result.sellerAddress);
        this.lookupState.set('ready');
      },
      error: (err: unknown) => {
        if (myToken !== this.lookupRequestId) return; // stale error
        const msg = err instanceof Error ? err.message : String(err);
        this.lookupError.set(`Lookup failed: ${msg}`);
        this.lookupState.set('error');
      },
    });
  }

  onCatNumberChange(value: string): void {
    this.draft.update((d) => ({ ...d, catNumberInput: value }));
    // Any edit invalidates the previous lookup result — bump the token
    // so a late-arriving in-flight response can't poison the state.
    // Audit H3.
    this.lookupRequestId++;
    this.lookupState.set('idle');
    this.lookupError.set(null);
    this.resolvedSellerAddress.set(null);
    this.orchestrator.setTargetCat(null);
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
      sellerPaymentAddressInput: '',
      priceSatsInput: '',
    });
    this.lookupState.set('idle');
    this.lookupError.set(null);
    this.resolvedSellerAddress.set(null);
  }
}
