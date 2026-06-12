import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Cat21MintOrchestrator, RecommendedFees } from 'ordpool-sdk';

type Tier = 'fastest' | 'halfHour' | 'hour';

interface TierOption {
  key: Tier;
  label: string;
  payloadKey: keyof Pick<RecommendedFees, 'fastestFee' | 'halfHourFee' | 'hourFee'>;
}

const TIERS: readonly TierOption[] = [
  { key: 'fastest',  label: 'Fastest (~10 min)', payloadKey: 'fastestFee' },
  { key: 'halfHour', label: 'Half hour',          payloadKey: 'halfHourFee' },
  { key: 'hour',     label: 'Hour',               payloadKey: 'hourFee' },
] as const;

/**
 * Pixel-themed fee picker. Three tier buttons fed by the SDK's polled
 * `recommendedFees$`, plus a manual sat/vB input. Selecting a tier or
 * editing the input emits `feeRateChange` and pushes the value into
 * the orchestrator via `setFeeRate` — the orchestrator is the
 * canonical source of truth for the active fee rate; this component
 * is a thin UI binding.
 *
 * Norton-shadow underline on the active tier matches the rest of the
 * cat21.space navigation language.
 */
@Component({
  selector: 'app-fees-picker',
  templateUrl: './fees-picker.html',
  styleUrl: './fees-picker.scss',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeesPicker {
  private orchestrator = inject(Cat21MintOrchestrator);

  /** Minimum sat/vB the form allows. The mint page enforces a hint above this; the input itself accepts anything ≥ this. */
  readonly minFeeRate = input<number>(1);

  /** Fires every time the active fee rate changes (tier click or manual edit). */
  readonly feeRateChange = output<number>();

  /** Current fee rate the user has picked, bridged from the orchestrator's signal. */
  readonly feeRate = this.orchestrator.feeRate;

  /** Polled tier values from the SDK. `undefined` until the first emission. */
  readonly fees = toSignal(this.orchestrator.recommendedFees$);

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

  /** Local mirror of the manual-input field, syncs from feeRate signal. */
  readonly manualInput = signal<number | null>(null);

  constructor() {
    // Keep the input's displayed value aligned with the orchestrator's
    // canonical fee rate whenever it changes (e.g. tier click).
    effect(() => {
      const current = this.feeRate();
      if (current !== this.manualInput()) {
        this.manualInput.set(current);
      }
    });

    // Auto-pick the "fastest" tier as soon as recommendedFees$ first
    // emits, but only if the orchestrator's fee rate is still null. The
    // orchestrator gates simulations on feeRate, so without this seed a
    // freshly-connected wallet would render "no viable UTXOs" until the
    // user manually clicked a tier — even when their UTXOs are fine.
    effect(() => {
      const fees = this.fees();
      if (fees && this.feeRate() === null && fees.fastestFee > 0) {
        this.orchestrator.setFeeRate(fees.fastestFee);
      }
    });
  }

  pickTier(t: TierOption): void {
    const fees = this.fees();
    if (!fees) return;
    const rate = fees[t.payloadKey];
    if (rate > 0) this.set(rate);
  }

  onManualInputChange(value: number | null): void {
    if (value === null) return;
    if (!Number.isFinite(value) || value < this.minFeeRate()) return;
    this.set(value);
  }

  private set(rate: number): void {
    this.orchestrator.setFeeRate(rate);
    this.feeRateChange.emit(rate);
  }
}
