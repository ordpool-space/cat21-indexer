import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { RouterLink } from '@angular/router';
import * as btc from '@scure/btc-signer';
import {
  Cat21Holding,
  Cat21TransferOrchestrator,
  Network,
  toScureNetwork,
  TransferSimulationOutcome,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';
import { CatUtxoLookupService, MyCatHolding } from '../../shared/cat-utxo-lookup.service';
import { rxResourceFixed } from '../../shared/rx-resource-fixed';

const TXID_RE = /^[0-9a-f]{64}$/i;

@Component({
  selector: 'app-transfer',
  templateUrl: './transfer.html',
  styleUrl: './transfer.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Transfer {
  private orchestrator = inject(Cat21TransferOrchestrator);
  private lookup = inject(CatUtxoLookupService);

  readonly txLinkBase = 'https://ordpool.space/tx/';

  // ---------- Live state from the orchestrator ----------

  readonly connectedWallet = this.orchestrator.connectedWallet;
  readonly state = this.orchestrator.state;
  readonly errorMessage = this.orchestrator.errorMessage;
  readonly successTxId = this.orchestrator.successTxId;
  readonly feeRate = this.orchestrator.feeRate;
  readonly catUtxo = this.orchestrator.catUtxo;
  readonly recipientAddress = this.orchestrator.recipientAddress;

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
      btc.Address(toScureNetwork(Network.Mainnet)).decode(raw);
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
    // orchestrator as the Cat21Holding it expects. The orchestrator's
    // existing wallet-change-reset clears this when the wallet swaps.
    effect(() => {
      const h = this.selectedHolding();
      if (!h) {
        this.orchestrator.setCatUtxo(null);
        return;
      }
      const holding: Cat21Holding = {
        catNumber: h.catNumber,
        txid: h.txid,
        vout: h.vout,
        value: h.value,
      };
      this.orchestrator.setCatUtxo(holding);
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
    });
  }

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
      btc.Address(toScureNetwork(Network.Mainnet)).decode(trimmed);
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
}
