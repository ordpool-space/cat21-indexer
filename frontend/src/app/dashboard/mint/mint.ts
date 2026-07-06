import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AUTO_SCAN_MAX_VALUE_SAT,
  Cat21MintOrchestrator,
  cat21Config,
  SMALL_UTXO_WARNING_THRESHOLD_SAT,
  SimulateTransactionResult,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
  UtxoSimulation,
  WalletService,
  bucketOf,
  calculateRecommendedFundingSats,
  findAutoPickCandidate,
  runeNamesFromContent,
} from 'ordpool-sdk';

import { FeesPicker } from '../../shared/fees-picker/fees-picker';
import { WalletConnect } from '../../shared/wallet-connect/wallet-connect';

interface ViableUtxoRow {
  utxo: TxnOutput;
  simulation: SimulateTransactionResult;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

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
  private config = inject(cat21Config);

  /** Where successfully minted tx ids link out (ordpool owns the tx-detail page). */
  readonly txLinkBase = 'https://ordpool.space/tx/';

  /** Asset-detail link bases sourced from cat21Config so dev / regtest / prod stay aligned with the scanner's own endpoints. */
  readonly ordReviewBase = this.config.ordApiUrl;
  readonly cat21OrdReviewBase = this.config.cat21OrdApiUrl;

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

  /**
   * Whether the "Choose a different funding source" panel opens
   * pre-expanded. True in the shallow-water cases (no auto-pick
   * possible, or auto-pick landed on a row whose safety we couldn't
   * verify), false on the happy path (auto-pick found a clean or
   * probably-clean source). Users can still toggle either way.
   */
  readonly pickerOpenByDefault = computed<boolean>(() => {
    const sel = this.selectedRow();
    if (!sel) return this.viableRows().length > 0;
    return sel.bucket === 'assets' || sel.bucket === 'failed';
  });

  readonly recommendedFundingSats = computed<number>(() => calculateRecommendedFundingSats(this.feeRate() ?? 1));

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
    return sel.utxo.value <= SMALL_UTXO_WARNING_THRESHOLD_SAT;
  });

  /** Was a UTXO-load error from the orchestrator. */
  readonly utxoError = computed(() => this.state() === 'error' && !this.mintAttempted() ? this.errorMessage() : null);

  /** Was a mint-time error from the orchestrator. */
  readonly mintError = computed(() => this.state() === 'error' && this.mintAttempted() ? this.errorMessage() : null);

  private mintAttempted = signal(false);
  private lastWalletAddress: string | null = null;

  // ---------- Lifecycle ----------

  constructor() {
    // Wipe the scanner cache when one wallet swaps out for another —
    // the previous wallet's UTXO outpoints aren't relevant to the new
    // one and would otherwise accumulate forever on a long-lived
    // session. Initial null → wallet is excluded: the scanner is
    // already empty so a reset would be a no-op anyway, and skipping
    // it avoids clobbering scan state any consumer pushed in early.
    effect(() => {
      const addr = this.connectedWallet()?.ordinalsAddress ?? null;
      if (this.lastWalletAddress !== null && addr !== this.lastWalletAddress) {
        this.scanner.reset();
      }
      this.lastWalletAddress = addr;
    });

    // Eager-scan small UTXOs the moment they arrive from electrs. The
    // scanner dedupes by outpoint + throttles fan-out internally, so
    // repeat triggers are free.
    effect(() => {
      const rows = this.viableRows();
      this.scanner.autoScan(rows.map((r) => ({ txid: r.utxo.txid, vout: r.utxo.vout, value: r.utxo.value })));
    });

    // Auto-pick the largest "safe-enough" UTXO whenever the row list
    // changes. Priority lives in the SDK (findAutoPickCandidate) so
    // ordpool and cat21.space can't drift.
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
      const pick = findAutoPickCandidate(rows);
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

  /** Pass-through to the SDK helper so the template can read rune names off a UtxoContent. */
  runeNames(content: UtxoContent): string[] { return runeNamesFromContent(content); }

  /** Hover-tooltip text for each bucket badge. Stays in the component (not the SDK) so the wording can match each site's voice. */
  bucketTooltip(bucket: UtxoScanBucket): string {
    switch (bucket) {
      case 'clean':
        return 'We checked this UTXO against ord and cat21-ord. No inscriptions, runes, or cats — safe to use as a mint input.';
      case 'assets':
        return 'This UTXO holds at least one inscription, rune, or CAT-21 cat. Spending it as a mint input would send the asset away to the miner as fee. Use "Use anyway" only if you really mean to.';
      case 'unscanned':
        return `Above the auto-scan threshold (${AUTO_SCAN_MAX_VALUE_SAT.toLocaleString()} sat) and very likely a plain payment. Click "Scan" to verify against ord and cat21-ord.`;
      case 'scanning':
        return 'Checking ord and cat21-ord for inscriptions, runes, and cats at this UTXO.';
      case 'failed':
        return 'One of the asset-detection endpoints (ord.ordpool.space or ord.cat21.space) didn\'t respond. Click "Retry scan" to try again.';
    }
  }

  /** FeesPicker's feeRateChange forwarded into this page's orchestrator. */
  onFeeRateChange(rate: number): void {
    this.orchestrator.setFeeRate(rate);
  }
}
