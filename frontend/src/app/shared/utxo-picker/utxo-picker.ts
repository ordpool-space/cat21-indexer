import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AUTO_SCAN_MAX_VALUE_SAT,
  bucketOf,
  findAutoPickCandidate,
  runeNamesFromContent,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
} from 'ordpool-sdk';

/** Shape the picker renders per row. Consumers pass in raw `TxnOutput`s;
 *  the picker joins each against the shared scanner's state. */
export interface UtxoPickerRow {
  utxo: TxnOutput;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

/**
 * Scanner-annotated funding-UTXO picker. Used by the mint, transfer,
 * and offer-create flows so a single scan-and-pick UX ships to every
 * surface that spends a wallet UTXO. The scanner primitive
 * (`UtxoContentScanner`) is a singleton, so state is shared across
 * pages within a session.
 *
 * The consumer owns:
 *   - the *input* list of candidate UTXOs (from an orchestrator's
 *     `fundingUtxos$` observable),
 *   - the *output* selection (bubble via `selectionChange` and store
 *     back in the orchestrator's `selectedFundingUtxo` signal).
 *
 * The picker owns:
 *   - triggering `scanner.autoScan` on every input change,
 *   - annotating each UTXO with its bucket,
 *   - the auto-pick decision (`clean → unscanned → failed`, never
 *     `assets`) when the consumer hasn't selected one,
 *   - the "Scan" affordance for above-threshold UTXOs,
 *   - the "Use anyway" affordance for asset-carrying rows.
 */
@Component({
  selector: 'app-utxo-picker',
  templateUrl: './utxo-picker.html',
  styleUrl: './utxo-picker.scss',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtxoPicker {
  private scanner = inject(UtxoContentScanner);

  /** Candidate funding UTXOs to enumerate + scan. */
  readonly utxos = input.required<readonly TxnOutput[]>();

  /** Consumer's currently-selected UTXO. Null = auto-pick. */
  readonly selected = input<TxnOutput | null>(null);

  /** Above this threshold, autoScan does nothing — picker shows "Scan" affordance. */
  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;

  /** Fires when the user clicks a row. Consumer stores this on the orchestrator. */
  readonly selectionChange = output<TxnOutput>();

  private readonly scanStates = toSignal(this.scanner.states$, {
    initialValue: new Map<string, UtxoScanState>() as ReadonlyMap<string, UtxoScanState>,
  });

  /** UTXOs joined against scanner state + bucket. Sorted by value desc so
   *  the auto-pick candidate (largest clean) appears first. */
  readonly rows = computed<UtxoPickerRow[]>(() => {
    const scanMap = this.scanStates();
    return [...this.utxos()]
      .sort((a, b) => b.value - a.value)
      .map((utxo) => {
        const outpoint = `${utxo.txid}:${utxo.vout}`;
        const scan = scanMap.get(outpoint) ?? { kind: 'not-scanned' };
        return { utxo, scan, bucket: bucketOf(scan) };
      });
  });

  /** Row corresponding to the consumer's `selected` signal. Null when
   *  the consumer hasn't picked one; the effect below auto-picks in
   *  that case. */
  readonly selectedRow = computed<UtxoPickerRow | null>(() => {
    const s = this.selected();
    if (!s) return null;
    return this.rows().find((r) => r.utxo.txid === s.txid && r.utxo.vout === s.vout) ?? null;
  });

  constructor() {
    // Fire off scans for every incoming UTXO. The scanner dedupes.
    effect(() => {
      this.scanner.autoScan(this.utxos().map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })));
    });

    // Auto-pick the safest row when the consumer hasn't picked one.
    effect(() => {
      const rows = this.rows();
      if (this.selected()) return;
      const pick = findAutoPickCandidate(rows);
      if (pick) this.selectionChange.emit(pick.utxo);
    });
  }

  onPick(row: UtxoPickerRow): void {
    this.selectionChange.emit(row.utxo);
  }

  onScanRow(row: UtxoPickerRow): void {
    this.scanner.scan(`${row.utxo.txid}:${row.utxo.vout}`).subscribe();
  }

  runeNames(content: UtxoContent): string[] {
    return runeNamesFromContent(content);
  }

  /** cat21.space sat page listing the cats on this UTXO. All share offset 0. */
  catSatLink(catSat: number): string {
    return `https://cat21.space/sat/${catSat}`;
  }

  bucketTooltip(bucket: UtxoScanBucket): string {
    switch (bucket) {
      case 'clean':
        return 'Checked against ord and cat21-ord. No inscriptions, runes, cats, or rare sats — safe to spend.';
      case 'assets':
        return 'This UTXO holds an inscription, rune, CAT-21 cat, or rare sat. Spending it will send the asset to the miner as fee.';
      case 'unscanned':
        return `Above the auto-scan threshold (${this.autoScanThreshold.toLocaleString()} sat) and very likely a plain payment. Click "Scan" to verify.`;
      case 'scanning':
        return 'Checking ord and cat21-ord.';
      case 'failed':
        return 'One of the asset-detection endpoints didn\'t respond. Click "Retry scan".';
    }
  }
}
