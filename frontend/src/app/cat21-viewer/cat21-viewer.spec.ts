import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CatDto } from '../shared/cat21-api';
import { Cat21Viewer } from './cat21-viewer';

/**
 * The mint-price readout. `mintPrice` must format the whole amount the minter
 * paid — the cat UTXO's value PLUS the mint fee (sats) — with a current-USD
 * equivalent, and must NOT read `feeRate` (sat/vB) or the fee alone. The value,
 * fee and feeRate here are deliberately distinct sentinels so a wrong field or
 * a dropped term changes the string.
 */
describe('Cat21Viewer mint price', () => {
  let fixture: ComponentFixture<Cat21Viewer>;
  let component: Cat21Viewer;

  // value + fee = 546 + 40834 = 41380; feeRate is a decoy. Only value/fee are
  // read by mintPrice; the rest satisfies the type.
  const cat = { catNumber: 42, value: 546, fee: 40834, feeRate: 231.68 } as unknown as CatDto;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Cat21Viewer],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(Cat21Viewer);
    component = fixture.componentInstance;
  });

  it('formats value + fee in sats with a current-USD equivalent', () => {
    fixture.componentRef.setInput('cat', cat);
    fixture.componentRef.setInput('btcUsd', 65000);
    // 546 + 40834 = 41380 sat = 0.0004138 BTC; at $65 000 that is $26.90.
    // Reading fee alone (40834) gives "40 834 sat (~$26.54)"; reading feeRate
    // (231.68) gives "231.68 sat (~$0.15)". Both fail this.
    expect(component.mintPrice()).toBe('41 380 sat (~$26.90)');
  });

  it('hides the USD suffix when no price is available (null)', () => {
    fixture.componentRef.setInput('cat', cat);
    fixture.componentRef.setInput('btcUsd', null);
    expect(component.mintPrice()).toBe('41 380 sat');
  });

  it('is empty with no cat', () => {
    fixture.componentRef.setInput('cat', undefined);
    expect(component.mintPrice()).toBe('');
  });

  it('shows the mint price for a normal cat, hides it for the Genesis Cat (#0)', () => {
    fixture.componentRef.setInput('cat', cat); // catNumber 42
    expect(component.showMintPrice()).toBe(true);

    fixture.componentRef.setInput('cat', { ...cat, catNumber: 0 } as unknown as CatDto);
    expect(component.showMintPrice()).toBe(false); // #0 has only its lore 21 BTC price

    fixture.componentRef.setInput('cat', undefined);
    expect(component.showMintPrice()).toBe(false);
  });
});
