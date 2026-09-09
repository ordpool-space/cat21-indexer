import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { Cat21Service, RecommendedFees } from 'ordpool-sdk';

import { FeesPicker } from './fees-picker';

/**
 * `Cat21Service.recommendedFees$` can error: a transient fee-endpoint hiccup,
 * or an environment with no `/fees/recommended` (regtest). A bare `toSignal`
 * RE-THROWS the source error when the signal is read, and this component reads
 * `fees()` in its template, in `activeTier`, and in an effect. Without a catch,
 * that throw lands in change detection and blanks the ENTIRE embedding money
 * screen (mint / make-offer / transfer), price and action included, not just
 * the fee buttons. The component must treat an errored stream as "no fees"
 * (undefined) and keep rendering its manual input.
 */
const FEES: RecommendedFees = { fastestFee: 8, halfHourFee: 5, hourFee: 3, economyFee: 1, minimumFee: 1 };

function create(recommendedFees$: Observable<RecommendedFees>): ComponentFixture<FeesPicker> {
  TestBed.configureTestingModule({
    imports: [FeesPicker],
    providers: [{ provide: Cat21Service, useValue: { recommendedFees$ } as Partial<Cat21Service> }],
  });
  return TestBed.createComponent(FeesPicker);
}

describe('FeesPicker', () => {
  it('renders the tier presets when the fee stream emits', () => {
    const fixture = create(of(FEES));
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('8 sat/vB');  // the fastest-tier preset, from the emitted fees
  });

  it('does NOT throw and keeps rendering when the fee stream errors', () => {
    let fixture!: ComponentFixture<FeesPicker>;
    // The guard: a bare toSignal re-throws here (on construction or first CD read).
    // With the catchError, the errored stream becomes undefined and nothing throws.
    expect(() => {
      fixture = create(throwError(() => new Error('no /fees/recommended')));
      fixture.detectChanges();
    }).not.toThrow();

    // The errored fee stream degrades to "no fees", not a blank screen.
    expect(fixture.componentInstance.fees()).toBeUndefined();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="fees-picker"]')).not.toBeNull();
    // The manual sat/vB input stays available as the degraded entry path.
    expect(host.querySelector('[data-testid="fees-picker-manual-input"]')).not.toBeNull();
  });
});
