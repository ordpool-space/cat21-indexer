import { TestBed } from '@angular/core/testing';
import { DroppedSelection } from 'ordpool-sdk';

import { DroppedSelectionNotice } from './dropped-selection-notice';

/**
 * Every drop reason the SDK reports must produce a sentence. The template is an
 * `@switch` with no default, so a reason without a case renders an EMPTY notice
 * box: the person sees the warning frame and no explanation. This pins all
 * three reasons, including `contents-changed`.
 */
function render(dropped: DroppedSelection, feeRate: number | null = null): string {
  const fixture = TestBed.createComponent(DroppedSelectionNotice);
  fixture.componentRef.setInput('dropped', dropped);
  fixture.componentRef.setInput('feeRate', feeRate);
  fixture.detectChanges();
  return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const TXID = 'c'.repeat(64);

describe('DroppedSelectionNotice', () => {
  it('words `gone`', () => {
    expect(render({ txid: TXID, vout: 1, reason: 'gone' }))
      .toBe(`The coin you picked, ${TXID}:1, is no longer available. Pick another coin below.`);
  });

  it('words `below-requirement` with the rate', () => {
    expect(render({ txid: TXID, vout: 0, reason: 'below-requirement' }, 50))
      .toBe(`The coin you picked, ${TXID}:0, no longer covers this transaction at 50 sat/vB. Lower the fee rate, or pick another coin below.`);
  });

  it('words `contents-changed` (assets appeared that were not shown at pick time)', () => {
    expect(render({ txid: TXID, vout: 2, reason: 'contents-changed' }))
      .toBe(`The coin you picked, ${TXID}:2, now carries assets that were not shown when you picked it. Review what it holds below, then pick it again or pick another coin.`);
  });
});
