import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DroppedSelection } from 'ordpool-sdk';

/**
 * Why the coin the person picked is not the coin the action spends, read off
 * the orchestrator snapshot's `droppedSelection`, and what to do about it:
 * `gone` (the coin is no longer among the wallet's spendable coins, pick
 * another) or `below-requirement` (the coin is still there but no longer covers
 * at this fee rate, lower the rate or pick another).
 *
 * The SDK decides the drop (`describeFundingPick`); this only words it. Without
 * the sentence the page shows the coin it will spend, which is correct about
 * the spend and silent about the swap. Rendered inline, inside the page's own
 * warning container, on mint, transfer and make-offer.
 */
@Component({
  selector: 'app-dropped-selection-notice',
  templateUrl: './dropped-selection-notice.html',
  // A full txid is one 64-character word; let it wrap on a phone.
  styles: [':host code { word-break: break-all; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DroppedSelectionNotice {
  readonly dropped = input.required<DroppedSelection>();

  /** The rate the drop was measured at, named in the `below-requirement` sentence. */
  readonly feeRate = input<number | null>(null);

  /** `<rate> sat/vB`, or "this fee rate" before a rate is set. */
  readonly rateText = computed(() => {
    const rate = this.feeRate();
    return rate === null ? 'this fee rate' : `${rate} sat/vB`;
  });
}
