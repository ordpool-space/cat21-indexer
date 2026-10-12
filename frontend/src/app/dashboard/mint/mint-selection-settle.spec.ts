/**
 * @test-kind unit
 * Real:   Mint component and the SDK Cat21MintOrchestrator it constructs
 * Faked:  Cat21Service -> { getUtxos, postTransaction: jest.fn() } (hand-written)
 *         UtxoContentScanner -> ScannerStub (testing/scanner.fixtures)
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 * Proves: re-picking the same outpoint as a fresh object does not re-emit the selection; a different outpoint does
 */
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
import { electrsConfirmedUtxoFixture } from 'ordpool-sdk/testing';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { Mint } from './mint';
import { WalletServiceStub } from '../../testing/wallet.fixtures';
import { ScannerStub } from '../../testing/scanner.fixtures';

/**
 * The picker re-renders its rows on every recompute, so a click on the coin
 * already picked hands mint.ts's `selectUtxoOutput` a fresh object of the same
 * outpoint. The SDK setter compares by outpoint, so that is a no-op and does not
 * emit; compared by identity it would recompute, clear `droppedSelection` and
 * re-render the rows again. Asserts the no-op from the real orchestrator the
 * page constructs.
 */
describe('Mint: re-picking the same outpoint does not re-emit the selection', () => {
  let orch: Cat21MintOrchestrator;

  const coin = (txid: string, vout = 0): TxnOutput => electrsConfirmedUtxoFixture({ txid, vout, value: 10_000 });
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
