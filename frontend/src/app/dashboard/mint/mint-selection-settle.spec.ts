import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import {
  Cat21MintOrchestrator,
  Cat21Service,
  Network,
  TxnOutput,
  UtxoContentScanner,
  WalletService,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { Mint } from './mint';
import { WalletServiceStub } from '../../testing/wallet.fixtures';
import { ScannerStub } from '../../testing/scanner.fixtures';

/**
 * Settle guard for the mint funding effect, at the boundary the SDK owns.
 *
 * mint.ts's effect reads `selectedUtxo()` and writes `setSelectedUtxo(match.utxo)`
 * with a FRESH row out of `allViableRows()` on every recompute. If the setter
 * emitted a new snapshot for that same-coin refresh, the component's snapshot
 * subscription would re-fire the effect, which would call the setter again: an
 * unbounded recompute loop, ~800 emissions/second, and the mint page never
 * settles. The SDK's funding setters compare by OUTPOINT, so a same-outpoint set
 * is a no-op and does not emit, which is what breaks the cycle.
 *
 * This asserts that mechanism from the orchestrator my component actually
 * constructs. A build, a unit assertion on a rendered element and a Playwright
 * snapshot are all green over that loop, because each asks whether something is
 * THERE and none asks whether the page has STOPPED changing. This asks.
 */
describe('Mint: a same-outpoint funding refresh does not re-emit (recompute-loop guard)', () => {
  let orch: Cat21MintOrchestrator;

  const coin = (txid: string, vout = 0): TxnOutput =>
    ({ txid, vout, value: 10_000, status: { confirmed: true } }) as TxnOutput;
  const OUT_A = 'a'.repeat(64);
  const OUT_B = 'b'.repeat(64);

  beforeEach(async () => {
    const cat21 = {
      getUtxos: jest.fn(() => of([])),
      postTransaction: jest.fn(() => of('txid')),
    } as unknown as Cat21Service;

    await TestBed.configureTestingModule({
      imports: [Mint],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        // Real Cat21MintOrchestrator, constructed by the component from its ports.
        { provide: Cat21Service, useValue: cat21 },
        { provide: UtxoContentScanner, useValue: new ScannerStub() },
        { provide: WalletService, useValue: new WalletServiceStub() },
        { provide: bitcoinNetwork, useValue: Network.Mainnet },
        {
          provide: cat21Config,
          useValue: {
            mempoolApiUrl: 'http://test',
            cat21ApiUrl: 'http://test',
            ordApiUrl: 'http://test',
            cat21OrdApiUrl: 'http://test',
          },
        },
      ],
    })
      .overrideComponent(Mint, { set: { imports: [], template: '<div></div>', schemas: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(Mint);
    orch = (fixture.componentInstance as unknown as { orch: Cat21MintOrchestrator }).orch;
    fixture.detectChanges();
  });

  it('a fresh object of the SAME outpoint is a no-op, a DIFFERENT outpoint emits', () => {
    orch.setSelectedUtxo(coin(OUT_A));

    let emissions = 0;
    // subscribe fires once immediately with the current snapshot: the baseline.
    const unsub = orch.subscribe(() => {
      emissions++;
    });
    expect(emissions).toBe(1);

    // Exactly what the effect passes each recompute: a new object, same outpoint.
    orch.setSelectedUtxo(coin(OUT_A));
    // The outpoint-compare guard makes it a no-op, so no new snapshot fires. If
    // the setter compared by identity, this would be 2 and the loop would exist.
    expect(emissions).toBe(1);

    // The counter CAN move, so the no-op assertion above is not vacuous: a
    // genuinely different outpoint is a real change and emits. It emits more than
    // once here (the recompute marks 'scanning' on entry, then lands the answer),
    // so assert movement, not an exact count that pins that internal step.
    orch.setSelectedUtxo(coin(OUT_B));
    expect(emissions).toBeGreaterThan(1);

    unsub();
  });
});
