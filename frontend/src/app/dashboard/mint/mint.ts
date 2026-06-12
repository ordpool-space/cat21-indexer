import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Cat21MintOrchestrator,
  SimulateTransactionResult,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanState,
  UtxoSimulation,
  WalletService,
  AUTO_SCAN_MAX_VALUE_SAT,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

interface ViableUtxoRow {
  utxo: TxnOutput;
  simulation: SimulateTransactionResult;
  scan: UtxoScanState;
  bucket: 'clean' | 'unscanned' | 'assets' | 'scanning' | 'failed';
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
  private scanner = inject(UtxoContentScanner);
  private wallet = inject(WalletService);

  /** Where successfully minted tx ids link out (ordpool owns the tx-detail page). */
  readonly txLinkBase = 'https://ordpool.space/tx/';

  /** Asset-detail links for the "asset found" row. */
  readonly ordReviewBase = 'https://ord.ordpool.space';
  readonly cat21OrdReviewBase = 'https://ord.cat21.space';

  /** Auto-scan threshold passed through to the template for the "Scan anyway" label. */
  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;

  // ---------- Live state from the orchestrator ----------

  readonly connectedWallet = this.orchestrator.connectedWallet;
  readonly state = this.orchestrator.state;
  readonly errorMessage = this.orchestrator.errorMessage;
  readonly successTxId = this.orchestrator.successTxId;
  readonly feeRate = this.orchestrator.feeRate;
  readonly selectedUtxo = this.orchestrator.selectedUtxo;

  private readonly simulations = toSignal(this.orchestrator.simulations$, { initialValue: [] as UtxoSimulation[] });
  private readonly scanStates = toSignal(this.scanner.states$, { initialValue: new Map<string, UtxoScanState>() as ReadonlyMap<string, UtxoScanState> });

  /** Viable rows only — insufficient UTXOs are dropped, sorted desc by UTXO value, capped at 10, annotated with scan state + bucket. */
  readonly viableRows = computed<ViableUtxoRow[]>(() => {
    const rows = this.simulations();
    const scanMap = this.scanStates();
    return rows
      .filter((r): r is { utxo: TxnOutput; simulation: SimulateTransactionResult; insufficient: false } =>
        !r.insufficient && r.simulation !== null,
      )
      .sort((a, b) => b.utxo.value - a.utxo.value)
      .slice(0, 10)
      .map((r): ViableUtxoRow => {
        const outpoint = `${r.utxo.txid}:${r.utxo.vout}`;
        const scan = scanMap.get(outpoint) ?? { kind: 'not-scanned' };
        return { utxo: r.utxo, simulation: r.simulation, scan, bucket: bucketOf(scan) };
      });
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
   * Whether to show the "small UTXO on single-address wallet" warning
   * for the currently selected row. Stays fee-rate-agnostic; purely
   * a content-safety hint about small UTXOs that we couldn't (or
   * weren't asked to) scan. Once a row is `scanned-clean`, this
   * disappears; once a row is `scanned-with-assets`, the more
   * specific asset-found warning takes over.
   */
  readonly showSmallUtxoWarning = computed<boolean>(() => {
    const sel = this.selectedRow();
    if (!sel) return false;
    if (!this.isSingleAddressWallet()) return false;
    if (sel.bucket === 'clean' || sel.bucket === 'assets') return false;
    return sel.utxo.value <= SMALL_UTXO_WARNING_THRESHOLD_SATS;
  });

  /** Was a UTXO-load error from the orchestrator. */
  readonly utxoError = computed(() => this.state() === 'error' && !this.mintAttempted() ? this.errorMessage() : null);

  /** Was a mint-time error from the orchestrator. */
  readonly mintError = computed(() => this.state() === 'error' && this.mintAttempted() ? this.errorMessage() : null);

  private mintAttempted = signal(false);

  // ---------- Lifecycle ----------

  constructor() {
    // Eager-scan small UTXOs the moment they arrive from electrs. The
    // scanner dedupes by outpoint, so repeat triggers are free.
    effect(() => {
      const rows = this.viableRows();
      this.scanner.autoScan(rows.map((r) => ({ txid: r.utxo.txid, vout: r.utxo.vout, value: r.utxo.value })));
    });

    // Auto-pick the largest "safe-enough" UTXO whenever the row list
    // changes. Priority: scanned-clean → unscanned (probably-safe big
    // UTXO) → scan-failed. NEVER auto-pick scanned-with-assets — that
    // row requires an explicit "Use anyway" click.
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
      if (stillThere) return;
      const pick =
        rows.find((r) => r.bucket === 'clean')
        ?? rows.find((r) => r.bucket === 'unscanned')
        ?? rows.find((r) => r.bucket === 'failed')
        ?? null;
      this.orchestrator.setSelectedUtxo(pick ? pick.utxo : null);
    });
  }

  // ---------- Commands ----------

  selectUtxo(row: ViableUtxoRow): void {
    this.orchestrator.setSelectedUtxo(row.utxo);
  }

  scanRow(row: ViableUtxoRow): void {
    this.scanner.scan(`${row.utxo.txid}:${row.utxo.vout}`).subscribe();
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

  // ---------- Template helpers ----------

  /** Helper for template — bigint → number for the | number pipe. */
  toNumber(n: bigint): number { return Number(n); }

  /** Extract the rune names from a UtxoContent. */
  runeNames(content: UtxoContent): string[] {
    return content.runes ? Object.keys(content.runes) : [];
  }
}

/**
 * Map a raw UtxoScanState to the picker's display bucket. The bucket
 * is what drives badges, button labels, and auto-pick priority. Kept
 * as a free function so the computed in `viableRows` stays inline-
 * declarative.
 */
function bucketOf(s: UtxoScanState): ViableUtxoRow['bucket'] {
  switch (s.kind) {
    case 'not-scanned': return 'unscanned';
    case 'scanning': return 'scanning';
    case 'scanned-clean': return 'clean';
    case 'scanned-with-assets': return 'assets';
    case 'scan-failed': return 'failed';
  }
}
