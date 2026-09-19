import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AUTO_SCAN_MAX_VALUE_SAT,
  bucketOf,
  CandidateFeeRow,
  CandidateFeeState,
  classifyCandidateFee,
  formatSatsWithUsd,
  outpointKey,
  runeNamesFromContent,
  TxnOutput,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanBucket,
  UtxoScanState,
} from 'ordpool-sdk';

import { PriceService } from '../price.service';
import { rareSatLabel } from '../rare-sat-label';
import { inscriptionReviewLink, runeEtchingReviewLink } from '../funding-asset-links';
import { runeRowLabel } from '../rune-row-label';
import { RuneEtchingService } from '../rune-etching.service';
import { ShortenString } from '../shorten-string';

/** Shape the picker renders per row. Consumers pass in raw `TxnOutput`s;
 *  the picker joins each against the shared scanner's state. */
export interface UtxoPickerRow {
  utxo: TxnOutput;
  scan: UtxoScanState;
  bucket: UtxoScanBucket;
}

/**
 * The fee states a funding coin can be in. Bound to the SDK's `CandidateFeeState`
 * and read through the SDK's `classifyCandidateFee`, never re-derived per surface:
 * the fold distinction is a policy the SDK owns (`absorbedSubDustSats`), and three
 * consumers reading the two raw fields three ways is exactly the drift that reader
 * exists to prevent. States: `normal` (pays the rate and emits change), `overpay`
 * (sub-dust change folds into the fee, a deliberate informational over-pay),
 * `overpay-unknown` (fee known, fold not reported, e.g. an inscribe row before the
 * fold is surfaced, so claim nothing about over-pay), `unavailable` (cannot fund at
 * this rate). Order is load-bearing: `unavailable` wins whatever the fold says,
 * because a null fee is not a fold question.
 */
export type FundingFeeState = CandidateFeeState;

/** A picker row enriched with its fee, recommendation, and confirmation for
 *  display. `fee: null` = no fee data for this row (the column is absent,
 *  e.g. a surface that has not wired `feeByOutpoint` yet). */
export interface UtxoDisplayRow {
  row: UtxoPickerRow;
  isRecommended: boolean;
  confirmed: boolean;
  fee: { state: FundingFeeState; money: string; overpaySats: number } | null;
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
  imports: [DecimalPipe, ShortenString],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtxoPicker {
  private scanner = inject(UtxoContentScanner);
  private runeEtching = inject(RuneEtchingService);
  private price = inject(PriceService);

  /** Candidate funding UTXOs to enumerate + scan. */
  readonly utxos = input.required<readonly TxnOutput[]>();

  /** Consumer's currently-selected UTXO. Null = auto-pick. */
  readonly selected = input<TxnOutput | null>(null);

  /**
   * Per-coin fee, keyed by `outpointKey`, from the orchestrator's
   * `candidateFees`. Optional: a surface that has not wired it renders no fee
   * column (the mint wires it; transfer/offer render as before until they do).
   * The fee is part of the pick because it differs between coins — sub-dust
   * change folds into the miner fee, so two coins at one rate cost different
   * money out.
   */
  readonly feeByOutpoint = input<ReadonlyMap<string, CandidateFeeRow> | null>(null);

  /**
   * `outpointKey` of the coin the SDK recommends, MARKED IN PLACE (never sorted
   * to the top): the cost column exists so the reader sees a cheaper-looking row
   * is cheaper for a reason, and re-sorting the recommendation first destroys
   * that comparison. The over-pay flag on the cheaper rows is the answer to
   * "why not that one?".
   */
  readonly recommendedOutpoint = input<string | null>(null);

  /**
   * The action's funding requirement in sats. Coins below it cannot fund the
   * action, so the scanner skips them (`autoScan`'s `minValueSat` floor) instead
   * of spending two ord round-trips per dust coin on rows no screen can act on.
   * Null = scan every coin (a surface that has not wired its requirement).
   */
  readonly minScanValueSat = input<number | null>(null);

  /** Above this threshold, autoScan does nothing — picker shows "Scan" affordance. */
  readonly autoScanThreshold = AUTO_SCAN_MAX_VALUE_SAT;

  /** Fires when the user clicks a row. Consumer stores this on the orchestrator. */
  readonly selectionChange = output<TxnOutput>();

  /** BTC/USD for the fee's Money shape. One source for every consumer; `null`
   *  (regtest, cold backend, network error) omits the fiat half entirely. */
  private readonly btcUsd = toSignal(this.price.getBtcUsd(), { initialValue: null });

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

  /**
   * `rows()` enriched with fee state, recommendation, and confirmation. Keeps
   * each `row` reference identical to `rows()` so `row === selectedRow()` still
   * holds. Each row's fee state comes from the SDK's `classifyCandidateFee`
   * (see `FundingFeeState`), never re-derived here; `money`/`overpaySats` are
   * display projections layered on top.
   */
  readonly displayRows = computed<UtxoDisplayRow[]>(() => {
    const feeMap = this.feeByOutpoint();
    const rec = this.recommendedOutpoint();
    const usd = this.btcUsd();
    return this.rows().map((row) => {
      const key = outpointKey(row.utxo);
      const feeRow = feeMap?.get(key) ?? null;
      let fee: UtxoDisplayRow['fee'] = null;
      if (feeRow) {
        // The STATE is the SDK's reading of the row, never re-derived here.
        // `money`/`overpaySats` are display projections: the over-pay amount
        // renders only in the `overpay` state, where the fold is a real > 0.
        const state = classifyCandidateFee(feeRow);
        fee = {
          state,
          money: feeRow.finalFeeSats === null ? '' : formatSatsWithUsd(feeRow.finalFeeSats, usd),
          overpaySats: state === 'overpay' ? (feeRow.absorbedSubDustSats ?? 0) : 0,
        };
      }
      return { row, isRecommended: key === rec, confirmed: row.utxo.status.confirmed, fee };
    });
  });

  constructor() {
    // Fire off scans for every incoming UTXO. The scanner dedupes.
    effect(() => {
      const floor = this.minScanValueSat();
      this.scanner.autoScan(
        this.utxos().map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })),
        floor ?? undefined,
      );
    });

    // Resolve rune etchings for every rune on every scanned row, when scans
    // arrive (not per render). The service is idempotent + caches, so this is
    // safe to run on each rows() change.
    effect(() => {
      const names = this.rows().flatMap((r) =>
        r.scan.kind === 'scanned-with-assets' ? runeNamesFromContent(r.scan.content) : [],
      );
      if (names.length > 0) this.runeEtching.resolve(names);
    });

    // No auto-pick here: the consumer's orchestrator auto-selects a
    // content-clean covering coin via the SDK's `fundingRecommendation$`
    // (safe-auto), so this shared picker is purely display + click-to-select
    // (the expert-mode override). Emitting a raw value-based pre-pick here
    // would fight the SDK's safe recommendation and could auto-adopt an
    // unscanned coin the SDK would have gated behind expert mode.
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

  /** [name, balance-value] pairs on a scanned UTXO, for the rune chips. */
  runeEntries(content: UtxoContent): [string, unknown][] {
    return Object.entries(content.runes ?? {});
  }

  /** In-family etching-tx link for a rune once resolved, else null (plain text). */
  runeEtchingHref(name: string): string | null {
    const txid = this.runeEtching.etchings().get(name);
    return txid ? runeEtchingReviewLink(txid, name) : null;
  }

  /** cat21.space sat page listing the cats on this UTXO. All share offset 0. */
  catSatLink(catSat: number): string {
    return `https://cat21.space/sat/${catSat}`;
  }

  /** Shared funding-row helpers; identical to the mint panel so the two can't drift. */
  readonly inscriptionReviewLink = inscriptionReviewLink;
  readonly runeRowLabel = runeRowLabel;
  readonly rareSatLabel = rareSatLabel;

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
