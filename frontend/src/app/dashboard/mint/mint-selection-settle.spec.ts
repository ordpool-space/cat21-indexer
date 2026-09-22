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
 * mint.ts's effect writes setSelectedUtxo() with a fresh row of the same outpoint
 * each recompute. The SDK setter compares by outpoint, so that is a no-op and does
 * not emit; without it the effect re-fires on its own write (recompute loop).
 * Asserts the no-op from the real orchestrator. See commit 8d44e2b.
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
    // subscribe fires once immediately: baseline.
    const unsub = orch.subscribe(() => {
      emissions++;
    });
    expect(emissions).toBe(1);

    // Fresh object, same outpoint: the no-op. Would be > 1 if compared by identity.
    orch.setSelectedUtxo(coin(OUT_A));
    expect(emissions).toBe(1);

    // Different outpoint emits, so the no-op assertion is not vacuous.
    orch.setSelectedUtxo(coin(OUT_B));
    expect(emissions).toBeGreaterThan(1);

    unsub();
  });
});
