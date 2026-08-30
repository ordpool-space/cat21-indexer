import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import * as btc from '@scure/btc-signer';
import {
  Cat21Service,
  Cat21TransferOrchestrator,
  TransferSnapshot,
  TxnOutput,
  WalletService,
  bitcoinNetwork,
  cat21Config,
  parseTransferQueryParams,
  toScureNetwork,
} from 'ordpool-sdk';

import { cat21OrchestratorPorts } from '../../shared/cat21-orchestrator-ports';
import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { PsbtExportBridgeService } from '../../shared/psbt-export-bridge/psbt-export-bridge.service';
import { UtxoPicker } from '../../shared/utxo-picker/utxo-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';
import { CatUtxoLookupService, MyCatHolding } from '../../shared/cat-utxo-lookup.service';
import { rxResourceFixed } from '../../shared/rx-resource-fixed';

const TXID_RE = /^[0-9a-f]{64}$/i;

@Component({
  selector: 'app-transfer',
  templateUrl: './transfer.html',
  styleUrl: './transfer.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, UtxoPicker, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Transfer {
  private psbtBridge = inject(PsbtExportBridgeService);
  private lookup = inject(CatUtxoLookupService);
  private walletService = inject(WalletService);
  private cat21 = inject(Cat21Service);
  private config = inject(cat21Config);
  private network = inject(bitcoinNetwork);
  private destroyRef = inject(DestroyRef);

  /** Constructed transfer orchestrator (shared ports; signing internal). */
  private orch = new Cat21TransferOrchestrator(
    cat21OrchestratorPorts(this.cat21, this.config.ordApiUrl, this.config.cat21OrdApiUrl, this.network),
  );
  private snap = signal<TransferSnapshot>(this.orch.getSnapshot());

  readonly txLinkBase = 'https://ordpool.space/tx/';

  /**
   * Query param `?catNumber=<n>` from a "Send" click on
   * `/cat/:catNumber`. Pre-selects the cat in the picker once the
   * connected wallet's holdings resolve. If the wallet doesn't hold
   * this cat, we ignore the param — form works as today.
   */
  readonly catNumberParam = input<string | undefined>(undefined, { alias: 'catNumber' });

  /**
   * Query params `?catTxid=<txid>&catVout=<n>` — direct override for
   * the picker. When both are present, skip the ord-driven holdings
   * lookup and use them as the cat UTXO. The UTXO's REAL value is read
   * from electrs (never assumed 546 — 546 is only the mint OUTPUT size,
   * not a property of an existing cat's UTXO). Used by deep-links that
   * already know the cat's outpoint; also unblocks e2e flows where ord
   * is unreachable and the picker would otherwise be empty (electrs
   * stays reachable, so the value lookup still resolves).
   */
  readonly catTxidParam = input<string | undefined>(undefined, { alias: 'catTxid' });
  readonly catVoutParam = input<string | undefined>(undefined, { alias: 'catVout' });

  /**
   * Network the frontend is configured against (injected via
   * `bitcoinNetwork` token in app.config.ts). Used for recipient-
   * address validation so the check honours regtest / testnet
   * builds instead of hard-failing anything but mainnet.
   */
  private readonly bitcoinNetwork = inject(bitcoinNetwork);

  // ---------- Live state ----------

  /** Connected wallet from WalletService (pushed into the orchestrator via setWallet). */
  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });
  readonly state = computed(() => this.snap().state);
  readonly errorMessage = computed(() => this.snap().errorMessage);
  readonly successTxId = computed(() => this.snap().successTxId);
  readonly feeRate = computed(() => this.snap().feeRate);
  readonly catUtxo = computed(() => this.snap().catUtxo);
  readonly recipientAddress = computed(() => this.snap().recipientAddress);
  readonly selectedFundingUtxo = computed(() => this.snap().selectedFundingUtxo);

  /**
   * The SDK's safe-auto funding recommendation. `expert-required` means no
   * content-clean coin covers the fee (only asset coins do), so the picker
   * must surface for a deliberate override. Its `candidates` are lifted to a
   * `TxnOutput`-superset (status + bucket), so they feed the UtxoPicker directly.
   */
  readonly fundingRecommendation = computed(() => this.snap().fundingRecommendation);

  /** Funding-UTXO list for the picker = the recommendation's candidates. */
  readonly fundingUtxos = computed<readonly TxnOutput[]>(() => this.fundingRecommendation().candidates);

  /** The transfer simulation (funding coin + fee + change), or null. */
  readonly simulation = computed(() => this.snap().simulation);

  /** No coin can fund the fee at this rate (nothing covers). */
  readonly insufficient = computed(() => this.fundingRecommendation().status === 'insufficient');

  readonly fundingExpertRequired = computed(
    () => this.fundingRecommendation().status === 'expert-required',
  );

  // ---------- My cats — async load ----------

  /**
   * Resource that fetches the user's current cat holdings (cat number +
   * current UTXO outpoint per cat) the moment a wallet connects. Drives
   * the cat-picker dropdown without requiring the user to know any txids.
   */
  readonly holdingsResource = rxResourceFixed({
    params: () => ({ ordinalsAddress: this.connectedWallet()?.ordinalsAddress ?? null }),
    stream: ({ params }) =>
      params.ordinalsAddress
        ? this.lookup.getMyHoldings(params.ordinalsAddress)
        : EMPTY,
  });

  readonly myHoldings = computed<readonly MyCatHolding[]>(
    () => this.holdingsResource.value() ?? [],
  );

  /** Currently selected cat (by inscription ID — stable across re-fetches). */
  readonly selectedInscriptionId = signal<string | null>(null);

  readonly selectedHolding = computed<MyCatHolding | null>(() => {
    const id = this.selectedInscriptionId();
    if (!id) return null;
    return this.myHoldings().find((h) => h.inscriptionId === id) ?? null;
  });

  /** Recipient address as typed by the user (sync with orchestrator). */
  readonly recipientInput = signal<string>('');

  /**
   * Recipient address validation status. `null` while empty;
   * `'valid'` once it decodes against the configured Bitcoin network;
   * `'invalid'` on any decode failure (bad checksum, wrong HRP for
   * mainnet, garbled paste). The orchestrator's setRecipientAddress is
   * only called when the address is valid — prevents the wallet popup
   * from ever being asked to sign against a typo'd recipient.
   * Audit finding H4.
   */
  readonly recipientStatus = computed<'empty' | 'valid' | 'invalid'>(() => {
    const raw = this.recipientInput().trim();
    if (!raw) return 'empty';
    try {
      btc.Address(toScureNetwork(this.bitcoinNetwork)).decode(raw);
      return 'valid';
    } catch {
      return 'invalid';
    }
  });

  /** Sanity-check the broadcast txid before binding it into an [href]. Audit L2. */
  readonly safeSuccessTxId = computed<string | null>(() => {
    const txid = this.successTxId();
    if (!txid || !TXID_RE.test(txid)) return null;
    return txid.toLowerCase();
  });

  readonly canTransfer = computed(() => {
    if (this.state() !== 'ready') return false;
    if (!this.catUtxo()) return false;
    if (!this.recipientAddress()) return false;
    if (this.recipientStatus() !== 'valid') return false;
    if (!this.feeRate()) return false;
    return !!this.simulation() && !this.insufficient();
  });

  /**
   * Wallet-swap form reset (audit M5). When the connected wallet's
   * ordinals address changes (different wallet picked AND it's not
   * just a BehaviorSubject re-emission), clear the local form fields
   * the orchestrator doesn't own: typed recipient, picked cat. The
   * orchestrator itself already resets its own state on wallet change;
   * this effect closes the form-state-leak gap.
   */
  private lastSeenOrdinalsAddress: string | null = null;

  constructor() {
    // Bind the orchestrator snapshot to a signal; unsubscribe on destroy.
    this.destroyRef.onDestroy(this.orch.subscribe((s) => this.snap.set(s)));

    // Push the connected wallet into the orchestrator (it fetches funding UTXOs
    // + recomputes). Async + dedupes internally.
    effect(() => {
      const w = this.connectedWallet();
      void this.orch.setWallet(
        w
          ? {
              type: w.type,
              ordinalsAddress: w.ordinalsAddress,
              ordinalsPublicKey: w.ordinalsPublicKey,
              paymentAddress: w.paymentAddress,
              paymentPublicKey: w.paymentPublicKey,
            }
          : null,
      );
    });

    // When the user picks a cat from the dropdown, push it to the
    // orchestrator as the Cat21Holding it expects. Picker takes
    // precedence; URL override is the fallback (deep-links that
    // already know the outpoint, or e2e where ord is unreachable).
    effect(() => {
      const fromPicker = this.selectedHolding();
      const fromUrl = this.urlCatUtxoResource.value() ?? null;
      if (fromPicker) {
        this.orch.setCatUtxo({
          catNumber: fromPicker.catNumber,
          txid: fromPicker.txid,
          vout: fromPicker.vout,
          value: fromPicker.value,
        });
      } else if (fromUrl) {
        this.orch.setCatUtxo(fromUrl);
      } else {
        this.orch.setCatUtxo(null);
      }
    });

    // Wallet-swap form reset (audit M5).
    effect(() => {
      const w = this.connectedWallet();
      const currentAddress = w?.ordinalsAddress ?? null;
      // First emission (null → wallet, or wallet → wallet stable) is
      // recorded but doesn't reset; only actual switches do.
      if (this.lastSeenOrdinalsAddress === null) {
        this.lastSeenOrdinalsAddress = currentAddress;
        return;
      }
      if (this.lastSeenOrdinalsAddress === currentAddress) return;
      this.lastSeenOrdinalsAddress = currentAddress;
      // Wallet swapped. Clear form fields the orchestrator doesn't own.
      this.selectedInscriptionId.set(null);
      this.recipientInput.set('');
      this.prefilledFor = null; // re-arm prefill for the new wallet
    });

    // Prefill catNumber from the "?catNumber=" query param. Waits for
    // holdings to resolve. If the connected wallet doesn't hold that
    // cat, the param is silently ignored — form works normally.
    effect(() => {
      const catNumberRaw = this.catNumberParam();
      const holdings = this.myHoldings();
      if (!catNumberRaw || holdings.length === 0) return;
      if (this.prefilledFor === catNumberRaw) return;
      const n = Number.parseInt(catNumberRaw, 10);
      if (!Number.isFinite(n) || n < 0) return;
      const match = holdings.find((h) => h.catNumber === n);
      if (!match) return; // wallet doesn't hold this cat
      this.prefilledFor = catNumberRaw;
      this.selectedInscriptionId.set(match.inscriptionId);
    });
  }

  /** See catNumberParam JSDoc: guards the prefill effect from re-running. */
  private prefilledFor: string | null = null;

  /**
   * Cat outpoint parsed from `?catTxid=&catVout=` query params. Returns
   * null when either param is missing or malformed. Carries only the
   * outpoint + display cat number; the UTXO VALUE is resolved separately
   * (see {@link urlCatUtxoResource}) by reading electrs — never guessed.
   */
  readonly urlCatOutpoint = computed<{ txid: string; vout: number; catNumber: number } | null>(() => {
    // Router's `withComponentInputBinding()` delivers the params via
    // input signals (catNumberParam, catTxidParam, catVoutParam). Feed
    // them to the SDK's `parseTransferQueryParams` — the canonical
    // parser for the same URL shape `buildTransferQueryParams` mints.
    const parsed = parseTransferQueryParams({
      catNumber: this.catNumberParam() ?? null,
      catTxid: this.catTxidParam() ?? null,
      catVout: this.catVoutParam() ?? null,
    });
    if (!parsed.catOutpoint) return null;
    // catNumber is display-only for the transfer picker fallback — an
    // unknown / malformed value degrades to 0 (Cat21Holding.catNumber
    // is not part of the tx signing surface).
    return {
      catNumber: parsed.catNumber ?? 0,
      txid: parsed.catOutpoint.txid,
      vout: parsed.catOutpoint.vout,
    };
  });

  /**
   * Resolves the deep-linked outpoint into a full `Cat21Holding` by
   * reading the UTXO's REAL value from electrs (a cat rides any-size
   * UTXO; 546 is only our mint OUTPUT size). Value stays `undefined`
   * while loading and null if the outpoint can't be found.
   */
  readonly urlCatUtxoResource = rxResourceFixed({
    params: () => ({ outpoint: this.urlCatOutpoint() }),
    stream: ({ params }) =>
      params.outpoint
        ? this.lookup.getHoldingByOutpoint(
            params.outpoint.txid,
            params.outpoint.vout,
            params.outpoint.catNumber,
          )
        : EMPTY,
  });

  // ---------- Commands ----------

  onCatPick(inscriptionId: string): void {
    this.selectedInscriptionId.set(inscriptionId || null);
  }

  onRecipientChange(value: string): void {
    this.recipientInput.set(value);
    // Only push into the orchestrator if the address actually decodes.
    // Audit H4: the wallet popup is no longer the last line of defense.
    const trimmed = value.trim();
    if (!trimmed) {
      this.orch.setRecipientAddress(null);
      return;
    }
    try {
      btc.Address(toScureNetwork(this.bitcoinNetwork)).decode(trimmed);
      this.orch.setRecipientAddress(trimmed);
    } catch {
      this.orch.setRecipientAddress(null);
    }
  }

  async onTransferClick(): Promise<void> {
    // Pass the export/paste bridge unconditionally: injected wallets ignore it,
    // a watch-only (xpub) wallet signs through it. The bridge is
    // Observable-based; the orchestrator wants a Promise, so bridge it. The
    // orchestrator signs+broadcasts internally and updates its snapshot, so
    // there is nothing to bind here.
    try {
      await this.orch.transfer((unsigned) => firstValueFrom(this.psbtBridge.promptForSignedPsbt(unsigned)));
    } catch {
      // Error fields are already populated in the orchestrator snapshot.
    }
  }

  onResetClick(): void {
    this.orch.reset();
    this.selectedInscriptionId.set(null);
    this.recipientInput.set('');
    this.holdingsResource.reload();
  }

  /** FeesPicker's feeRateChange forwarded into the transfer orchestrator. */
  onFeeRateChange(rate: number): void {
    this.orch.setFeeRate(rate);
  }

  /** UtxoPicker's selectionChange forwarded into the transfer orchestrator. */
  onFundingUtxoSelectionChange(utxo: TxnOutput): void {
    this.orch.setSelectedFundingUtxo(utxo);
  }
}
