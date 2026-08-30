import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, firstValueFrom } from 'rxjs';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  AcceptOfferSnapshot,
  CapabilitySupport,
  Cat21AcceptOfferOrchestrator,
  Cat21OfferRejectionReason,
  Cat21Service,
  WalletCapability,
  bitcoinNetwork,
  capabilityOf,
  parseAcceptOfferQueryParams,
  toPaymentAddress,
  WalletService,
} from 'ordpool-sdk';

import { CatUtxoLookupService, MyCatHolding } from '../../../shared/cat-utxo-lookup.service';
import { PsbtExportBridgeService } from '../../../shared/psbt-export-bridge/psbt-export-bridge.service';
import { rxResourceFixed } from '../../../shared/rx-resource-fixed';
import { WalletCapabilityNotice } from '../../../shared/wallet-capability-notice/wallet-capability-notice';
import { WalletConnect } from '../../../shared/wallet-connect/wallet-connect';

@Component({
  selector: 'app-accept-offer',
  templateUrl: './accept-offer.html',
  styleUrl: './accept-offer.scss',
  imports: [DecimalPipe, RouterLink, WalletConnect, WalletCapabilityNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptOffer implements OnInit {
  private psbtBridge = inject(PsbtExportBridgeService);
  private walletService = inject(WalletService);
  private lookup = inject(CatUtxoLookupService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  /**
   * The framework-agnostic accept-offer orchestrator, CONSTRUCTED. Accept
   * carries no funding (the buyer already funded the PSBT), so it needs only a
   * broadcast port + network. `postTransaction` resolves to a txid, which we
   * wrap into the port's `BroadcastOutcome` (offers are standard-size -> mempool).
   *
   * The `inject(..., { optional: true }) ??` prefix is the unit-test seam: in
   * production nothing provides the SDK class, so it resolves to `null` and the
   * real orchestrator is `new`-constructed here (the deps are `inject`ed inside
   * the fallback, so a spec that provides a drivable stub short-circuits them).
   */
  private orch = inject(Cat21AcceptOfferOrchestrator, { optional: true })
    ?? ((): Cat21AcceptOfferOrchestrator => {
      const cat21 = inject(Cat21Service);
      const network = inject(bitcoinNetwork);
      return new Cat21AcceptOfferOrchestrator({
        broadcast: (hex) => firstValueFrom(cat21.postTransaction(hex)).then((txid) => ({ txid, channel: 'mempool' as const })),
        network,
      });
    })();

  private snap = signal<AcceptOfferSnapshot>(this.orch.getSnapshot());

  readonly txLinkBase = 'https://ordpool.space/tx/';

  // ---------- Live state ----------

  /** Connected wallet from WalletService (pushed into the orchestrator via setWallet). */
  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });

  /** The matrix capability this page drives; feeds the disabled-action notice. */
  readonly offerAcceptCapability = WalletCapability.Cat21OfferAccept;

  /**
   * True when a wallet is connected but the matrix marks it Unsupported
   * for accepting offers (Alby: its signPsbt can't sign only input 0 and
   * leave the buyer's pre-signed inputs untouched). Template shows the
   * notice instead of the accept flow.
   */
  readonly walletBlocksAccept = computed(() => {
    const w = this.connectedWallet();
    return !!w && capabilityOf(w.type, WalletCapability.Cat21OfferAccept).support === CapabilitySupport.Unsupported;
  });

  readonly state = computed(() => this.snap().state);
  readonly errorMessage = computed(() => this.snap().errorMessage);
  readonly successTxId = computed(() => this.snap().successTxId);
  /** The parsed/validated offer preview (renamed `preview` in the snapshot). */
  readonly parsedOffer = computed(() => this.snap().preview);
  readonly validationResult = computed(() => this.snap().validationResult);
  readonly pastedOffer = computed(() => this.snap().pastedOffer);
  readonly expectedCatUtxo = computed(() => this.snap().expectedCatUtxo);
  readonly floorPriceSats = computed(() => this.snap().floorPriceSats);
  /** A valid, parsed offer is ready to accept. */
  readonly canAccept = computed(() => this.snap().state === 'parsed');

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
    // Bind the orchestrator snapshot to a signal; unsubscribe on destroy.
    this.destroyRef.onDestroy(this.orch.subscribe((s) => this.snap.set(s)));

    // Push the connected wallet (seller identity) into the orchestrator. Accept
    // signs input 0 with the seller's ORDINALS key, so its wallet context is
    // {type, ordinalsAddress, ordinalsPublicKey} (no payment address). setWallet
    // is synchronous here + dedupes internally.
    effect(() => {
      const w = this.connectedWallet();
      this.orch.setWallet(
        w ? { type: w.type, ordinalsAddress: w.ordinalsAddress, ordinalsPublicKey: w.ordinalsPublicKey } : null,
      );
    });

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
        this.orch.setExpectedCatUtxo({ txid: fromPicker.txid, vout: fromPicker.vout });
      } else if (fromUrl) {
        this.orch.setExpectedCatUtxo(fromUrl);
      } else {
        this.orch.setExpectedCatUtxo(null);
      }
      if (wallet) {
        // Seller's "payment" output goes to whichever address the
        // seller wants their BTC. Default to their connected wallet's
        // payment address (the typical case); the buyer's offer
        // builds the seller-payment-output against this address.
        // The setter is branded — `toPaymentAddress` is where we ratify
        // "this is the wallet's payment address, not its ordinals one".
        this.orch.setExpectedSellerPaymentAddress(toPaymentAddress(wallet.paymentAddress));
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

  }

  ngOnInit(): void {
    // Opt out of the SDK's floor safety-net. The seller sees
    // `pricePaidSats` in the summary panel before signing, so the
    // human IS the check. The floor input stays available for
    // sellers who WANT to enforce a minimum (raise the value → SDK
    // validator auto-rejects lowballs). Bot / headless consumers
    // keep the null-required gate (see docstring on
    // `disableFloorGate`).
    this.orch.disableFloorGate();

    // Auto-fill from ?offer=…&catTxid=…&catVout=… so a buyer can hand
    // the seller a one-click accept link. The SDK's
    // `parseAcceptOfferQueryParams` is the canonical parser — matches
    // the shape `buildAcceptOfferQueryParams` produces on the make-offer
    // page. Malformed values (bad txid, negative vout) come back null
    // so a tampered URL degrades to the manual-paste flow.
    const parsed = parseAcceptOfferQueryParams(this.route.snapshot.queryParams);
    if (parsed.catOutpoint) {
      this.urlCatOutpoint.set(parsed.catOutpoint);
    }
    if (parsed.offerBase64) {
      this.orch.setPastedOffer(parsed.offerBase64);
    }
  }

  // ---------- Commands ----------

  onPasteChange(value: string): void {
    this.orch.setPastedOffer(value);
  }

  onCatPick(inscriptionId: string): void {
    this.selectedInscriptionId.set(inscriptionId || null);
  }

  onFloorPriceChange(value: string): void {
    this.floorPriceInput.set(value);
    const trimmed = value.trim();
    // Empty input = "no floor" = accept any positive offer. Same
    // effect as typing 0. Lets the seller clear the field to lower
    // their minimum without hunting for the 0 key.
    if (trimmed === '') {
      this.orch.setFloorPriceSats(0);
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (Number.isFinite(n) && n >= 0) {
      this.orch.setFloorPriceSats(n);
    }
  }

  async onAcceptClick(): Promise<void> {
    // Pass the export/paste bridge unconditionally: injected wallets ignore it,
    // a watch-only (xpub) wallet signs through it. The bridge is
    // Observable-based; the orchestrator wants a Promise, so bridge it. The
    // orchestrator signs+broadcasts internally and updates its snapshot, so
    // there is nothing to bind here.
    try {
      await this.orch.acceptOffer((unsigned) => firstValueFrom(this.psbtBridge.promptForSignedPsbt(unsigned)));
    } catch {
      // Error fields are already populated in the orchestrator snapshot.
    }
  }

  onResetClick(): void {
    this.orch.reset();
    this.selectedInscriptionId.set(null);
    this.floorPriceInput.set('');
    this.holdingsResource.reload();
  }
}

function rejectionToHuman(reason: Cat21OfferRejectionReason, detail?: string): string {
  switch (reason) {
    case 'malformed-offer-psbt':
      return `The offer isn't a valid PSBT (bad magic bytes, parse failure, or no inputs). ${detail ?? ''}`.trim();
    case 'missing-seller-input':
      return `The offer's input 0 doesn't reference your cat. ${detail ?? ''}`.trim();
    case 'wrong-postage':
      // The cat output value must be at least the dust floor. It is NOT
      // pinned to 546: ord preserves the cat's real UTXO value on the
      // offer's output 0 (see the SDK offer builder / ord `offer create`),
      // so any-size cat is legal as long as it clears dust.
      return `The cat output value is below the dust floor. ${detail ?? ''}`.trim();
    case 'wrong-price':
      return `The seller-payment output is below your floor price. ${detail ?? ''}`.trim();
    case 'wrong-price-exact':
      return `The offer's price doesn't exactly match the expected amount. ${detail ?? ''}`.trim();
    case 'wrong-seller-input-value':
      return `The offer's declared seller-input value doesn't match your cat's on-chain value. ${detail ?? ''}`.trim();
    case 'sighash-not-all':
      return `The offer commits with a sighash other than SIGHASH_ALL — not accepting that. ${detail ?? ''}`.trim();
    case 'sighash-flag-byte-not-all':
      return `A signature in the offer uses a sighash flag byte other than SIGHASH_ALL (0x01). ${detail ?? ''}`.trim();
    case 'buyer-input-unsigned':
      return `The buyer hasn't signed all their funding inputs yet. ${detail ?? ''}`.trim();
    case 'missing-seller-payment-output':
      return `The offer's payment output is missing. ${detail ?? ''}`.trim();
    case 'payment-output-wrong-address':
      return `The seller-payment output is going to a different address than expected. ${detail ?? ''}`.trim();
    case 'cat-output-not-spendable':
      return `The cat output has no valid address, so it would be unspendable. ${detail ?? ''}`.trim();
    case 'cat-output-wrong-address':
      return `The cat output is going to a different address than the buyer's receive address. ${detail ?? ''}`.trim();
    case 'change-output-wrong-address':
      return `The buyer's change output is going to an unexpected address. ${detail ?? ''}`.trim();
    default: {
      // Compile-time exhaustiveness: a new Cat21OfferRejectionReason in the
      // SDK fails the build here instead of silently hitting a generic string.
      const unhandled: never = reason;
      return `Rejected: ${String(unhandled)} ${detail ?? ''}`.trim();
    }
  }
}
