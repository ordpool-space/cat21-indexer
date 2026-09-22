import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import {
  Cat21MintOrchestrator,
  Cat21Service,
  Network,
  UtxoContentScanner,
  WalletService,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { Mint } from './mint';
import { makeWallet, WalletServiceStub } from '../../testing/wallet.fixtures';
import { ScannerStub } from '../../testing/scanner.fixtures';

// ---------------------------------------------------------------------------
// Wallet RE-EMISSION seam test, at THIS component's wiring rather than the
// SDK's. `WalletService.connectedWallet$` is a bare BehaviorSubject and
// `onAccountChange` (which Xverse + cat21-wallet fire repeatedly) re-emits the
// SAME wallet as a NEW object. The component binds it via `toSignal` + an
// `effect` that builds a fresh context object and calls `orch.setWallet`.
//
// The exposure: if `setWallet` re-fetches UTXOs on an unchanged wallet, the
// re-emission drops the orchestrator back through `loading-utxos` and tears
// out every control gated on that state for a frame, an intermittent lost
// click on a money path. The E2E lanes CANNOT prove this is fixed: they
// connect once per spec, so they only exercise the CHANGED path (null->wallet)
// and never the unchanged one, and the bug is intermittent so a green run is
// what it looked like most of the time already.
//
// This test uses the REAL orchestrator (the component `new`s it when no stub
// is provided) so the pin itself is the mutation-check: RED on a pin where
// setWallet re-fetches unconditionally, GREEN once setWallet no-ops on an
// unchanged wallet. The deterministic anchor is the getUtxos CALL COUNT (not a
// transient state read): a second setWallet that no-ops never calls the port.
// It ties the fix to THIS wiring: the fresh object the effect builds must be
// value-equal enough for the SDK's `sameWallet` to recognise it (the risk a
// sibling surface hit by building a context object that differed each emission).
// ---------------------------------------------------------------------------


const TEST_TEMPLATE = `
  @if (!connectedWallet()) {
    <div data-testid="mint-cta">connect</div>
  } @else if (state() === 'loading-utxos') {
    <div data-testid="mint-loading">loading</div>
  } @else {
    <div data-testid="ready">ready</div>
  }
`;

describe('Mint: wallet re-emission does not re-fetch UTXOs (setWallet no-op on unchanged)', () => {
  let wallets: WalletServiceStub;
  let getUtxos: jest.Mock;
  let fixture: ComponentFixture<Mint>;
  let component: Mint;

  // Flush the zoneless effect + the async setWallet (firstValueFrom(getUtxos)).
  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    wallets = new WalletServiceStub();
    // Immediate empty UTXO set; the exposure is about HOW MANY TIMES this is
    // called, not what it returns.
    getUtxos = jest.fn(() => of([]));
    const cat21 = { getUtxos, postTransaction: jest.fn(() => of('txid')) } as unknown as Cat21Service;

    await TestBed.configureTestingModule({
      imports: [Mint],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        // Cat21MintOrchestrator deliberately NOT provided -> the component
        // constructs the REAL orchestrator from these ports.
        { provide: Cat21Service, useValue: cat21 },
        { provide: UtxoContentScanner, useValue: new ScannerStub() },
        { provide: WalletService, useValue: wallets },
        { provide: bitcoinNetwork, useValue: Network.Mainnet },
        {
          provide: cat21Config,
          useValue: {
            mempoolApiUrl: 'http://test-mempool',
            cat21ApiUrl: 'http://test-cat21',
            ordApiUrl: 'http://test-ord',
            cat21OrdApiUrl: 'http://test-cat21-ord',
          },
        },
      ],
    })
      .overrideComponent(Mint, { set: { imports: [], template: TEST_TEMPLATE, schemas: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(Mint);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('re-emitting an identical wallet as a new object does NOT re-enter loading / re-fetch UTXOs', async () => {
    // Spy on the REAL orchestrator the component constructed. jest.spyOn calls
    // through, so setWallet keeps its real behaviour; we only count the calls.
    const orch = (component as unknown as { orch: Cat21MintOrchestrator }).orch;
    const setWalletSpy = jest.spyOn(orch, 'setWallet');

    // Connect (null -> wallet): the CHANGED path, one real load.
    wallets.connectedWalletSubject.next(makeWallet());
    await settle();
    expect(component.state()).toBe('ready');
    expect(getUtxos).toHaveBeenCalledTimes(1);

    // Re-emit the SAME wallet as a NEW object, exactly what an onAccountChange
    // re-emission delivers through the bare BehaviorSubject.
    wallets.connectedWalletSubject.next(makeWallet());
    await settle();

    // BOTH halves of the mechanism, asserted so neither can silently decay:
    //  (1) OUR WIRING delivered the repeat: the effect re-fired on the new
    //      object, so setWallet was reached a second time. If a later upstream
    //      dedupe (a `distinctUntilChanged`, a by-reference signal) stopped the
    //      effect firing, this reds and tells the reader the premise changed,
    //      rather than the getUtxos count silently agreeing at 1 for the wrong
    //      reason.
    expect(setWalletSpy).toHaveBeenCalledTimes(2);
    //  (2) The SDK RECOGNISED the repeat and no-op'd: no second fetch, so no
    //      loading-utxos flip and no torn-out control. On a pin that re-fetches
    //      unconditionally this is 2 and the test reds.
    expect(getUtxos).toHaveBeenCalledTimes(1);
    expect(component.state()).toBe('ready');
  });
});
