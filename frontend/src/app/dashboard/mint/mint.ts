import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Cat21MintOrchestrator,
  SimulateTransactionResult,
  TxnOutput,
  UtxoSimulation,
  WalletService,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

interface ViableUtxoRow {
  utxo: TxnOutput;
  simulation: SimulateTransactionResult;
}

/**
 * UTXOs at or below this value, on a single-address wallet, are flagged
 * as potentially holding an ordinal-bound asset (inscription, rune, sat
 * rarity, CAT-21 cat). The 10k sat figure is the de-facto industry cut-
 * off: most ordinal-bearing UTXOs are 546 sat (the dust limit) or
 * slightly above; almost none exceed 10k. This is content-safety
 * heuristics, not fee math — it stays fee-rate-agnostic.
 */
const SMALL_UTXO_WARNING_THRESHOLD_SATS = 10_000;

@Component({
  selector: 'app-mint',
  templateUrl: './mint.html',
  styleUrl: './mint.scss',
  imports: [DecimalPipe, RouterLink, FeesPicker, WalletConnect],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Mint {
  private orchestrator = inject(Cat21MintOrchestrator);
  private wallet = inject(WalletService);

  /** Where successfully minted tx ids link out (ordpool owns the tx-detail page). */
  readonly txLinkBase = 'https://ordpool.space/tx/';

  // ---------- Live state from the orchestrator ----------

  readonly connectedWallet = this.orchestrator.connectedWallet;
  readonly state = this.orchestrator.state;
  readonly errorMessage = this.orchestrator.errorMessage;
  readonly successTxId = this.orchestrator.successTxId;
  readonly feeRate = this.orchestrator.feeRate;
  readonly selectedUtxo = this.orchestrator.selectedUtxo;

  private readonly simulations = toSignal(this.orchestrator.simulations$, { initialValue: [] as UtxoSimulation[] });

  /** Viable rows only — insufficient UTXOs are dropped here, sorted desc by UTXO value, capped at 10. */
  readonly viableRows = computed<ViableUtxoRow[]>(() => {
    const rows = this.simulations();
    return rows
      .filter((r): r is { utxo: TxnOutput; simulation: SimulateTransactionResult; insufficient: false } =>
        !r.insufficient && r.simulation !== null,
      )
      .sort((a, b) => b.utxo.value - a.utxo.value)
      .slice(0, 10)
      .map((r) => ({ utxo: r.simulation ? r.utxo : r.utxo, simulation: r.simulation! }));
  });

  /** Whether the form has at least one viable UTXO + a fee rate set. */
  readonly canMint = computed(() => this.viableRows().length > 0 && this.feeRate() !== null && this.selectedUtxo() !== null && this.state() === 'ready');

  /** The simulation entry currently picked, for the summary panel. */
  readonly selectedRow = computed<ViableUtxoRow | null>(() => {
    const picked = this.selectedUtxo();
    if (!picked) return null;
    return this.viableRows().find(
      (r) => r.utxo.txid === picked.txid && r.utxo.vout === picked.vout,
    ) ?? null;
  });

  /** Expert mode toggle — collapsed by default. */
  readonly expertMode = signal(false);

  /**
   * Funding target shown in the empty-state hint. Derived from the
   * currently-picked fee rate using a conservative ~200 vB vsize
   * (real CAT-21 mints are ~150–170 vB depending on wallet type),
   * rounded up to the next 100 sat so the number reads cleanly.
   * At 1 sat/vB that's ~800 sat; at 100 sat/vB it's ~20,600 sat.
   * Reference vsize stays above the largest known CAT-21 mint so
   * the displayed floor is never under the SDK's real check.
   */
  readonly recommendedFundingSats = computed<number>(() => {
    const rate = this.feeRate() ?? 1;
    return Math.ceil((546 + 200 * rate) / 100) * 100;
  });

  /**
   * Whether the connected wallet exposes one address for both payments
   * and ordinals. Detected via address equality — no SDK flag for this.
   * Unisat: same. Xverse / Leather / OKX / Phantom / Magic Eden Wallet:
   * different. On a single-address wallet, every UTXO at the payment
   * address is also potentially an ordinals-bearing UTXO; the picker
   * has to warn the user before they accidentally spend an inscription /
   * rune / cat sat as transaction change.
   */
  readonly isSingleAddressWallet = computed<boolean>(() => {
    const w = this.connectedWallet();
    if (!w) return false;
    return w.ordinalsAddress === w.paymentAddress;
  });

  /**
   * Whether to show the "small UTXO on single-address wallet" warning.
   * Independent of fee rate — purely about content-safety on UTXOs at
   * or below the small-utxo threshold.
   */
  readonly showSmallUtxoWarning = computed<boolean>(() => {
    const sel = this.selectedRow();
    if (!sel) return false;
    if (!this.isSingleAddressWallet()) return false;
    return sel.utxo.value <= SMALL_UTXO_WARNING_THRESHOLD_SATS;
  });

  /** Was a UTXO-load error from the orchestrator. */
  readonly utxoError = computed(() => this.state() === 'error' && !this.mintAttempted() ? this.errorMessage() : null);

  /** Was a mint-time error from the orchestrator. */
  readonly mintError = computed(() => this.state() === 'error' && this.mintAttempted() ? this.errorMessage() : null);

  private mintAttempted = signal(false);

  // ---------- Lifecycle ----------

  constructor() {
    // Auto-pick the largest viable UTXO whenever the simulation list
    // refreshes — unless the user has already picked one that's still
    // present.
    effect(() => {
      const rows = this.viableRows();
      if (rows.length === 0) {
        if (this.selectedUtxo()) this.orchestrator.setSelectedUtxo(null);
        return;
      }
      const current = this.selectedUtxo();
      const stillThere = current && rows.find(
        (r) => r.utxo.txid === current.txid && r.utxo.vout === current.vout,
      );
      if (!stillThere) {
        this.orchestrator.setSelectedUtxo(rows[0].utxo);
      }
    });
  }

  // ---------- Commands ----------

  selectUtxo(row: ViableUtxoRow): void {
    this.orchestrator.setSelectedUtxo(row.utxo);
  }

  toggleExpertMode(): void {
    this.expertMode.update((v) => !v);
  }

  mint(): void {
    this.mintAttempted.set(true);
    this.orchestrator.mint().subscribe({
      error: () => {/* error fields are already populated by the orchestrator */},
    });
  }

  mintAnother(): void {
    this.mintAttempted.set(false);
    this.orchestrator.reset();
  }

  /** Helper for template — bigint → number for the | number pipe. */
  toNumber(n: bigint): number { return Number(n); }
}
