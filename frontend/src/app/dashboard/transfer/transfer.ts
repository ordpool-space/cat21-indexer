import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { RouterLink } from '@angular/router';
import {
  Cat21Holding,
  Cat21TransferOrchestrator,
  TransferSimulationOutcome,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';
import { CatUtxoLookupService, MyCatHolding } from '../../shared/cat-utxo-lookup.service';
import { rxResourceFixed } from '../../shared/rx-resource-fixed';

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

  readonly canTransfer = computed(() => {
    if (this.state() !== 'ready') return false;
    if (!this.catUtxo()) return false;
    if (!this.recipientAddress()) return false;
    if (!this.feeRate()) return false;
    const outcome = this.simulationOutcome();
    return !!outcome && !outcome.insufficient && !!outcome.simulation;
  });

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
  }

  // ---------- Commands ----------

  onCatPick(inscriptionId: string): void {
    this.selectedInscriptionId.set(inscriptionId || null);
  }

  onRecipientChange(value: string): void {
    this.recipientInput.set(value);
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
    this.selectedInscriptionId.set(null);
    this.recipientInput.set('');
    this.holdingsResource.reload();
  }
}
