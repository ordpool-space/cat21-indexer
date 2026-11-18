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

/**
 * The static "Price: 21 BTC" lore row is Cat #0's alone (template guard
 * `cat.catNumber === 0`). This renders the detail table and asserts the row
 * appears for #0 and for no other cat, so the mutation `=== 0` → always-true
 * (which would price every cat at 21 BTC) turns red.
 */
describe('Cat21Viewer genesis price row (#0 only)', () => {
  let fixture: ComponentFixture<Cat21Viewer>;

  // A complete row so the detail table renders. Trait values match the
  // parser's frozen output for the Genesis Cat; catNumber is overridden
  // per case. Only the price row's `=== 0` guard is under test here.
  const fullCat = {
    id: 'uuid-1',
    catNumber: 0,
    txHash: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892',
    blockHash: '000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7',
    blockHeight: 824205,
    mintedAt: '2024-01-03T21:04:46.000Z',
    mintedBy: 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh',
    fee: 40834,
    weight: 705,
    size: 195,
    feeRate: 231.67,
    sat: 596964966600565,
    value: 546,
    category: 'sub1',
    genesis: true,
    catColors: ['#555555', '#d3d3d3', '#ffffff', '#aaaaaa', '#ff9999'],
    gender: 'Female',
    designIndex: 24,
    designPose: 'Standing',
    designExpression: 'Grumpy',
    designPattern: 'Eyepatch',
    designFacing: 'Left',
    laserEyes: 'Red',
    background: 'Orange',
    backgroundColors: ['#ff9900'],
    crown: 'None',
    glasses: 'None',
    glassesColors: [],
    rarityBits: null,
    rarityRank: null,
    rarityCategoryTotal: 1,
  } as unknown as CatDto;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Cat21Viewer],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(Cat21Viewer);
    fixture.componentRef.setInput('showDetails', true);
  });

  function renderedText(cat: CatDto): string {
    fixture.componentRef.setInput('cat', cat);
    fixture.detectChanges();
    return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
  }

  it('renders the 21 BTC price row for the Genesis Cat (#0)', () => {
    const text = renderedText({ ...fullCat, catNumber: 0 } as CatDto);
    expect(text).toContain('21 BTC');
  });

  it('renders no 21 BTC price row for any other cat', () => {
    const text = renderedText({ ...fullCat, catNumber: 42 } as CatDto);
    expect(text).not.toContain('21 BTC');
  });
});
