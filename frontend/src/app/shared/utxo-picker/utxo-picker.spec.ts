import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import {
  CandidateFeeRow,
  TxnOutput,
  UtxoContentScanner,
  UtxoScanState,
  outpointKey,
} from 'ordpool-sdk';

import { UtxoPicker } from './utxo-picker';

/**
 * Minimal scanner stub: the picker reads `states$` (a stream of the outpoint →
 * scan-state map) and calls `autoScan` on every input change. For these tests
 * no coin is scanned, so every row is `not-scanned` (bucket `unscanned`), which
 * is orthogonal to the fee-state logic under test.
 */
class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();
  autoScan = jest.fn((_: unknown[]) => undefined);
  scan = jest.fn(() => ({ subscribe: () => undefined }));
}

function utxo(txid: string, vout: number, value: number, confirmed = true): TxnOutput {
  return { txid, vout, value, status: { confirmed } };
}

function feeRow(
  txid: string,
  vout: number,
  finalFeeSats: number | null,
  absorbedSubDustSats: number | null,
): CandidateFeeRow {
  return { txid, vout, finalFeeSats, vsize: finalFeeSats === null ? null : 110, absorbedSubDustSats };
}

describe('UtxoPicker (shared funding-coin picker)', () => {
  let fixture: ComponentFixture<UtxoPicker>;
  let component: UtxoPicker;
  let scanner: ScannerStub;

  beforeEach(async () => {
    scanner = new ScannerStub();
    await TestBed.configureTestingModule({
      imports: [UtxoPicker],
      // PriceService is providedIn: 'root' and, with the empty regtest
      // `mempoolApiUrl`, its `getBtcUsd()` returns of(null) without an HTTP call
      // — so the fee's Money shape drops the fiat half, which is what we assert.
      providers: [provideHttpClient(), { provide: UtxoContentScanner, useValue: scanner }],
    }).compileComponents();
    fixture = TestBed.createComponent(UtxoPicker);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('utxos', []);
    fixture.detectChanges();
  });

  // Re-pointed from mint.spec's MATRIX-I21(B): the tooltip helper moved from the
  // mint page onto this shared picker in the convergence. Same assertion, new
  // (correct) subject.
  it('bucketTooltip returns a non-empty string for every bucket kind', () => {
    const buckets = ['clean', 'unscanned', 'assets', 'scanning', 'failed'] as const;
    for (const b of buckets) {
      const tip = component.bucketTooltip(b);
      expect(typeof tip).toBe('string');
      expect(tip.length).toBeGreaterThan(0);
    }
  });

  describe('displayRows: the three fee states from absorbedSubDustSats', () => {
    it('NORMAL: finalFeeSats set + absorbedSubDustSats 0 -> normal, money rendered, no over-pay', () => {
      const u = utxo('aa', 0, 5000);
      fixture.componentRef.setInput('utxos', [u]);
      fixture.componentRef.setInput('feeByOutpoint', new Map([[outpointKey(u), feeRow('aa', 0, 300, 0)]]));
      fixture.detectChanges();
      const d = component.displayRows().find((x) => x.row.utxo.txid === 'aa')!;
      expect(d.fee?.state).toBe('normal');
      expect(d.fee?.money).toContain('300');
      expect(d.fee?.money).not.toContain('$'); // no rate in test -> fiat half omitted
      expect(d.fee?.overpaySats).toBe(0);
    });

    it('OVER-PAY: absorbedSubDustSats > 0 -> overpay state carrying the folded sats', () => {
      const u = utxo('bb', 0, 700);
      fixture.componentRef.setInput('utxos', [u]);
      fixture.componentRef.setInput('feeByOutpoint', new Map([[outpointKey(u), feeRow('bb', 0, 500, 154)]]));
      fixture.detectChanges();
      const d = component.displayRows().find((x) => x.row.utxo.txid === 'bb')!;
      expect(d.fee?.state).toBe('overpay');
      expect(d.fee?.overpaySats).toBe(154);
      expect(d.fee?.money).toContain('500');
    });

    it('UNAVAILABLE: finalFeeSats null -> unavailable, no money string', () => {
      const u = utxo('cc', 0, 200);
      fixture.componentRef.setInput('utxos', [u]);
      fixture.componentRef.setInput('feeByOutpoint', new Map([[outpointKey(u), feeRow('cc', 0, null, null)]]));
      fixture.detectChanges();
      const d = component.displayRows().find((x) => x.row.utxo.txid === 'cc')!;
      expect(d.fee?.state).toBe('unavailable');
      expect(d.fee?.money).toBe('');
    });

    it('no fee entry for a row -> fee null (column absent, e.g. an unwired surface)', () => {
      const u = utxo('dd', 0, 5000);
      fixture.componentRef.setInput('utxos', [u]);
      fixture.componentRef.setInput('feeByOutpoint', new Map());
      fixture.detectChanges();
      expect(component.displayRows().find((x) => x.row.utxo.txid === 'dd')!.fee).toBeNull();
    });
  });

  describe('recommendedOutpoint marks in place (never re-sorts)', () => {
    it('marks exactly the matching row and leaves the value-desc order intact', () => {
      const big = utxo('aa', 0, 9000);
      const small = utxo('bb', 0, 5000);
      fixture.componentRef.setInput('utxos', [small, big]); // deliberately out of order
      fixture.componentRef.setInput('recommendedOutpoint', outpointKey(small));
      fixture.detectChanges();
      const rows = component.displayRows();
      expect(rows.find((r) => r.row.utxo.txid === 'bb')!.isRecommended).toBe(true);
      expect(rows.find((r) => r.row.utxo.txid === 'aa')!.isRecommended).toBe(false);
      // Marked in place: the recommendation is NOT hoisted to the top. Value-desc
      // sort holds, so the bigger coin still leads and the cost comparison the
      // column exists for stays readable.
      expect(rows[0].row.utxo.txid).toBe('aa');
    });
  });

  it('confirmed status rides through from the TxnOutput', () => {
    const conf = utxo('aa', 0, 5000, true);
    const unconf = utxo('bb', 0, 4000, false);
    fixture.componentRef.setInput('utxos', [conf, unconf]);
    fixture.detectChanges();
    const rows = component.displayRows();
    expect(rows.find((r) => r.row.utxo.txid === 'aa')!.confirmed).toBe(true);
    expect(rows.find((r) => r.row.utxo.txid === 'bb')!.confirmed).toBe(false);
  });
});
