import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CatDto } from '../shared/cat21-api';
import { Cat21Viewer } from './cat21-viewer';

/**
 * The mint-price readout. `mintPrice` must format the total mint FEE (sats) —
 * what the minter actually paid — with a current-USD equivalent, and must NOT
 * accidentally read `feeRate` (sat/vB), which is a different quantity that
 * would show a wrong, misleadingly-precise price. The fee and feeRate here are
 * deliberately distinct sentinels so a field swap changes the string.
 */
describe('Cat21Viewer mint price', () => {
  let fixture: ComponentFixture<Cat21Viewer>;
  let component: Cat21Viewer;

  // Only fee / feeRate are read by mintPrice; the rest satisfies the type.
  const cat = { catNumber: 42, fee: 40834, feeRate: 231.68 } as unknown as CatDto;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Cat21Viewer],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(Cat21Viewer);
    component = fixture.componentInstance;
  });

  it('formats the mint FEE in sats with a current-USD equivalent', () => {
    fixture.componentRef.setInput('cat', cat);
    fixture.componentRef.setInput('btcUsd', 65000);
    // 40834 sat = 0.00040834 BTC; at $65 000 that is $26.54. Reading feeRate
    // (231.68) instead would yield "231.68 sat (~$0.15)" and fail this.
    expect(component.mintPrice()).toBe('40 834 sat (~$26.54)');
  });

  it('hides the USD suffix when no price is available (null)', () => {
    fixture.componentRef.setInput('cat', cat);
    fixture.componentRef.setInput('btcUsd', null);
    expect(component.mintPrice()).toBe('40 834 sat');
  });

  it('is empty with no cat', () => {
    fixture.componentRef.setInput('cat', undefined);
    expect(component.mintPrice()).toBe('');
  });
});
