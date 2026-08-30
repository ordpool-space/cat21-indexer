import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE, Cat21Service, RecommendedFees } from 'ordpool-sdk';

type Tier = 'fastest' | 'halfHour' | 'hour' | 'economy';

interface TierOption {
  key: Tier;
  label: string;
  payloadKey: keyof Pick<RecommendedFees, 'fastestFee' | 'halfHourFee' | 'hourFee' | 'economyFee'>;
}

const TIERS: readonly TierOption[] = [
  { key: 'fastest',  label: 'Fastest (~10 min)', payloadKey: 'fastestFee' },
  { key: 'halfHour', label: 'Half hour',          payloadKey: 'halfHourFee' },
  { key: 'hour',     label: 'Hour',               payloadKey: 'hourFee' },
  { key: 'economy',  label: 'Economy',            payloadKey: 'economyFee' },
] as const;

/**
 * Pixel-themed fee picker. Three tier buttons fed by `Cat21Service`'s polled
 * `recommendedFees$`, plus a manual sat/vB input. Selecting a tier or editing
 * the input emits `feeRateChange`, which the parent forwards into its
 * orchestrator's `setFeeRate` — the orchestrator is the canonical source of
 * truth for the active fee rate; this component is a thin UI binding.
 *
 * Norton-shadow underline on the active tier matches the rest of the
 * cat21.space navigation language.
 */
@Component({
  selector: 'app-fees-picker',
  templateUrl: './fees-picker.html',
  styleUrl: './fees-picker.scss',
  imports: [DecimalPipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeesPicker {
  private cat21 = inject(Cat21Service);

  /**
   * Minimum sat/vB the manual input will accept. Defaults to the SDK's
   * sourced `BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE` (Bitcoin Core's
   * `-minrelaytxfee` floor; the constant's own JSDoc carries the version
   * sourcing, so there is no drift-prone number or attribution here). Set
   * higher via [minFeeRate]="N" on the caller if a page wants a harder
   * floor; anything below it won't relay on a default-config node.
   */
  readonly minFeeRate = input<number>(BITCOIN_MIN_RELAY_FEE_SAT_PER_VBYTE);

  /**
   * Current fee rate from the parent's orchestrator. The picker
   * highlights the matching tier + shows this in the manual input
   * field. Parent forwards `(feeRateChange)` back into its own
   * orchestrator's `setFeeRate` — that keeps the picker
   * orchestrator-agnostic (it's used from mint, transfer, make-offer,
   * accept-offer, all with different orchestrators).
   *
   * `recommendedFees$` (the polled tier values) is sourced from
   * `Cat21Service` because those values are network-global, not
   * per-cat-operation — one poller, everyone reads.
   */
  readonly feeRate = input<number | null>(null);

  /** Fires every time the active fee rate changes (tier click, manual edit, or auto-seed on first-fees). */
  readonly feeRateChange = output<number>();

  /** Polled tier values from the SDK. `undefined` until the first emission. */
  readonly fees = toSignal(this.cat21.recommendedFees$);

  readonly tiers = TIERS;

  /** Which tier (if any) is currently picked — i.e. whose payloadKey-fee equals the active feeRate. */
  readonly activeTier = computed<Tier | null>(() => {
    const fees = this.fees();
    const current = this.feeRate();
    if (!fees || current === null) return null;
    for (const t of TIERS) {
      if (fees[t.payloadKey] === current) return t.key;
    }
    return null;
  });

  /** Local mirror of the manual-input field, syncs from feeRate input. */
  readonly manualInput = signal<number | null>(null);

  constructor() {
    // Keep the input's displayed value aligned with the parent's
    // canonical fee rate whenever it changes (e.g. tier click).
    effect(() => {
      const current = this.feeRate();
      if (current !== this.manualInput()) {
        this.manualInput.set(current);
      }
    });

    // Auto-seed the "fastest" tier as soon as recommendedFees$ first
    // emits, but only if the parent's fee rate is still null. Every
    // orchestrator downstream gates its simulation on feeRate, so
    // without this seed a freshly-connected wallet would render "no
    // viable UTXOs" until the user manually clicked a tier — even when
    // their UTXOs are fine.
    effect(() => {
      const fees = this.fees();
      if (fees && this.feeRate() === null && fees.fastestFee > 0) {
        this.feeRateChange.emit(fees.fastestFee);
      }
    });
  }

  pickTier(t: TierOption): void {
    const fees = this.fees();
    if (!fees) return;
    const rate = fees[t.payloadKey];
    if (rate > 0) this.feeRateChange.emit(rate);
  }

  onManualInputChange(value: number | null): void {
    if (value === null) return;
    if (!Number.isFinite(value) || value < this.minFeeRate()) return;
    this.feeRateChange.emit(value);
  }
}
