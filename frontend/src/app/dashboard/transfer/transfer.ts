import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { RouterLink } from '@angular/router';
import * as btc from '@scure/btc-signer';
import {
  bitcoinNetwork,
  Cat21Holding,
  Cat21TransferOrchestrator,
  parseTransferQueryParams,
  toScureNetwork,
  TransferSimulationOutcome,
  TxnOutput,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
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
  private orchestrator = inject(Cat21TransferOrchestrator);
  private lookup = inject(CatUtxoLookupService);

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
   * lookup and use them as the cat UTXO. Value is always 546 sats
   * (SDK HARD RULE: cat UTXO is always 546 sats). Used by deep-links
   * that already know the cat's outpoint; also unblocks e2e flows
   * where ord is unreachable and the picker would otherwise be empty.
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

  // ---------- Live state from the orchestrator ----------

  readonly connectedWallet = this.orchestrator.connectedWallet;
  readonly state = this.orchestrator.state;
  readonly errorMessage = this.orchestrator.errorMessage;
  readonly successTxId = this.orchestrator.successTxId;
  readonly feeRate = this.orchestrator.feeRate;
  readonly catUtxo = this.orchestrator.catUtxo;
  readonly recipientAddress = this.orchestrator.recipientAddress;
  readonly selectedFundingUtxo = this.orchestrator.selectedFundingUtxo;

  /** Live funding-UTXO list for the picker; empty array until wallet loads. */
  readonly fundingUtxos = toSignal(this.orchestrator.fundingUtxos$, {
    initialValue: [] as TxnOutput[],
  });

  readonly simulationOutcome = toSignal<TransferSimulationOutcome | null>(
    this.orchestrator.simulation$,
    { initialValue: null },
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
    const outcome = this.simulationOutcome();
    return !!outcome && !outcome.insufficient && !!outcome.simulation;
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
    // When the user picks a cat from the dropdown, push it to the
    // orchestrator as the Cat21Holding it expects. Picker takes
    // precedence; URL override is the fallback (deep-links that
    // already know the outpoint, or e2e where ord is unreachable).
    effect(() => {
      const fromPicker = this.selectedHolding();
      const fromUrl = this.urlCatUtxo();
      if (fromPicker) {
        this.orchestrator.setCatUtxo({
          catNumber: fromPicker.catNumber,
          txid: fromPicker.txid,
          vout: fromPicker.vout,
          value: fromPicker.value,
        });
      } else if (fromUrl) {
        this.orchestrator.setCatUtxo(fromUrl);
      } else {
        this.orchestrator.setCatUtxo(null);
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
   * Cat outpoint parsed from `?catTxid=&catVout=` query params. The
   * picker's effect uses this as a fallback when no picker selection
   * is active. Returns null when either param is missing or malformed.
   */
  readonly urlCatUtxo = computed<Cat21Holding | null>(() => {
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
      value: 546,
    };
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
      this.orchestrator.setRecipientAddress(null);
      return;
    }
    try {
      btc.Address(toScureNetwork(this.bitcoinNetwork)).decode(trimmed);
      this.orchestrator.setRecipientAddress(trimmed);
    } catch {
      this.orchestrator.setRecipientAddress(null);
    }
  }

  onTransferClick(): void {
    this.orchestrator.transfer().subscribe({
      // Tap + catchError inside the orchestrator already manage state +
      // error + success signals; this is just a fire-and-forget kick.
      error: () => undefined,
    });
  }

  onResetClick(): void {
    this.orchestrator.reset();
    this.selectedInscriptionId.set(null);
    this.recipientInput.set('');
    this.holdingsResource.reload();
  }

  /** FeesPicker's feeRateChange forwarded into the transfer orchestrator. */
  onFeeRateChange(rate: number): void {
    this.orchestrator.setFeeRate(rate);
  }

  /** UtxoPicker's selectionChange forwarded into the transfer orchestrator. */
  onFundingUtxoSelectionChange(utxo: TxnOutput): void {
    this.orchestrator.setSelectedFundingUtxo(utxo);
  }
}
