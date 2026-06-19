import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import {
  Cat21Holding,
  Cat21TransferOrchestrator,
  TransferSimulationOutcome,
  WalletService,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

interface DraftCatHolding {
  catNumberInput: string;
  outpointInput: string;
  recipientInput: string;
}

@Component({
  selector: 'app-transfer',
  templateUrl: './transfer.html',
  styleUrl: './transfer.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Transfer {
  private orchestrator = inject(Cat21TransferOrchestrator);
  private walletService = inject(WalletService);

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

  // ---------- Local form state (typed by the user) ----------

  readonly draft = signal<DraftCatHolding>({
    catNumberInput: '',
    outpointInput: '',
    recipientInput: '',
  });

  readonly parsedOutpoint = computed<{ txid: string; vout: number } | null>(() => {
    const raw = this.draft().outpointInput.trim();
    if (!raw) return null;
    const m = raw.match(/^([0-9a-fA-F]{64})\s*:\s*(\d+)$/);
    if (!m) return null;
    return { txid: m[1].toLowerCase(), vout: Number.parseInt(m[2], 10) };
  });

  readonly utxoError = computed<string | null>(() => {
    const err = this.errorMessage();
    return err ?? null;
  });

  readonly canTransfer = computed(() => {
    if (this.state() !== 'ready') return false;
    if (!this.catUtxo()) return false;
    if (!this.recipientAddress()) return false;
    if (!this.feeRate()) return false;
    const outcome = this.simulationOutcome();
    return !!outcome && !outcome.insufficient && !!outcome.simulation;
  });

  // ---------- Commands ----------

  onOutpointChange(value: string): void {
    this.draft.update((d) => ({ ...d, outpointInput: value }));
    const parsed = this.parsedOutpoint();
    if (parsed) {
      const catNum = Number.parseInt(this.draft().catNumberInput, 10);
      const holding: Cat21Holding = {
        catNumber: Number.isFinite(catNum) ? catNum : -1,
        txid: parsed.txid,
        vout: parsed.vout,
        // CAT-21 cat UTXOs are always 546 sats — trusted from protocol.
        value: 546,
      };
      this.orchestrator.setCatUtxo(holding);
    } else {
      this.orchestrator.setCatUtxo(null);
    }
  }

  onCatNumberChange(value: string): void {
    this.draft.update((d) => ({ ...d, catNumberInput: value }));
    // Re-emit the holding to pick up the new catNumber on the existing outpoint.
    this.onOutpointChange(this.draft().outpointInput);
  }

  onRecipientChange(value: string): void {
    this.draft.update((d) => ({ ...d, recipientInput: value }));
    this.orchestrator.setRecipientAddress(value);
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
    this.draft.set({ catNumberInput: '', outpointInput: '', recipientInput: '' });
  }
}
