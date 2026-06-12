import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  of,
  Subject,
  throwError,
} from 'rxjs';

import {
  AUTO_SCAN_MAX_VALUE_SAT,
  Cat21MintOrchestrator,
  KnownOrdinalWalletType,
  RecommendedFees,
  SimulateTransactionResult,
  TxnOutput,
  UtxoContentScanner,
  UtxoScanState,
  UtxoSimulation,
  WalletInfo,
  WalletService,
  cat21Config,
} from 'ordpool-sdk';

import { Mint } from './mint';

// ---------------------------------------------------------------------------
// Tiny fixture builders. Real production types have lots of fields we don't
// need to pin in every test; these helpers fill the surface so each test
// stays focused on the one knob it varies.
// ---------------------------------------------------------------------------

function utxo(over: Partial<TxnOutput> = {}): TxnOutput {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    value: 50_000,
    status: { confirmed: true, block_height: 800_000, block_hash: 'b'.repeat(64), block_time: 1_700_000_000 },
    ...over,
  };
}

function simulation(over: Partial<SimulateTransactionResult> = {}): SimulateTransactionResult {
  return {
    finalTransactionFee: 200n,
    amountToRecipient: 546n,
    singleInputAmount: 50_000n,
    changeAmount: 49_254n,
    vsize: 150,
    // The component never reads `tx`; fixtures keep it as an empty
    // object cast to the real btc.Transaction type to satisfy
    // structural checks without dragging in @scure/btc-signer.
    tx: {} as SimulateTransactionResult['tx'],
    ...over,
  };
}

function wallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return {
    type: KnownOrdinalWalletType.xverse,
    ordinalsAddress: 'bc1p-ordinals-addr',
    paymentAddress: '3-payment-addr',
    paymentPublicKey: '02' + 'aa'.repeat(32),
    ordinalsPublicKey: '02' + 'bb'.repeat(32),
    signingSupported: true,
    ...over,
  };
}

/**
 * Lightweight stand-in for Cat21MintOrchestrator. Every reactive field
 * the Mint component reads is mutable from a test (signals.set,
 * subject.next) so we can drive the full state machine without ever
 * touching the real orchestrator's RxJS chain.
 */
class OrchestratorStub {
  readonly connectedWallet: WritableSignal<WalletInfo | null> = signal(null);
  readonly state: WritableSignal<'idle' | 'loading-utxos' | 'ready' | 'minting' | 'success' | 'error'> = signal('idle');
  readonly errorMessage: WritableSignal<string | null> = signal(null);
  readonly successTxId: WritableSignal<string | null> = signal(null);
  readonly feeRate: WritableSignal<number | null> = signal(null);
  readonly selectedUtxo: WritableSignal<TxnOutput | null> = signal(null);

  readonly simulationsSubject = new BehaviorSubject<UtxoSimulation[]>([]);
  readonly simulations$ = this.simulationsSubject.asObservable();

  readonly recommendedFeesSubject = new Subject<RecommendedFees>();
  readonly recommendedFees$ = this.recommendedFeesSubject.asObservable();

  readonly mintReturn$ = new Subject<{ txId: string }>();
  readonly mintCalls: number = 0;
  mintImpl: () => Observable<{ txId: string }> = () => this.mintReturn$.asObservable();

  setFeeRate = jest.fn((r: number) => this.feeRate.set(r));
  setSelectedUtxo = jest.fn((u: TxnOutput | null) => this.selectedUtxo.set(u));
  mint = jest.fn(() => this.mintImpl());
  reset = jest.fn(() => {
    this.feeRate.set(null);
    this.selectedUtxo.set(null);
    this.errorMessage.set(null);
    this.successTxId.set(null);
    this.state.set(this.connectedWallet() ? 'ready' : 'idle');
  });
}

/**
 * UtxoContentScanner stand-in. The states$ observable feeds the Mint
 * component's `scanStates` signal; the scan/autoScan spies let us
 * assert what the component asked for. No actual network is touched.
 */
class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();
  scan = jest.fn((_: string) => of<UtxoScanState>({ kind: 'scanned-clean' }));
  autoScan = jest.fn((_: unknown[]) => undefined);
  reset = jest.fn(() => {
    this.statesSubject.next(new Map());
  });
  getState = jest.fn((outpoint: string): UtxoScanState => this.statesSubject.value.get(outpoint) ?? { kind: 'not-scanned' });

  /** Test helper: push a state map update. */
  setStates(states: Iterable<[string, UtxoScanState]>): void {
    this.statesSubject.next(new Map(states));
  }
}

class WalletServiceStub {
  readonly connectedWalletSubject = new BehaviorSubject<WalletInfo | null>(null);
  readonly connectedWallet$ = this.connectedWalletSubject.asObservable();
  readonly wallets$ = new BehaviorSubject({ installedWallets: [], notInstalledWallets: [] }).asObservable();
  connectWallet = jest.fn();
  disconnectWallet = jest.fn();
  requestWalletConnect = jest.fn();
}

// ---------------------------------------------------------------------------

describe('Mint component (cat21.space /dashboard/mint)', () => {
  let orch: OrchestratorStub;
  let scanner: ScannerStub;
  let wallets: WalletServiceStub;
  let fixture: ComponentFixture<Mint>;
  let component: Mint;

  async function configure(): Promise<void> {
    orch = new OrchestratorStub();
    scanner = new ScannerStub();
    wallets = new WalletServiceStub();
    await TestBed.configureTestingModule({
      imports: [Mint],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21MintOrchestrator, useValue: orch },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: wallets },
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
      // Mint imports FeesPicker + WalletConnect. We don't care about
      // their internals here; let the schema accept their selectors
      // without trying to compile their templates.
      .overrideComponent(Mint, {
        set: { imports: [], template: TEST_TEMPLATE, schemas: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(Mint);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /**
   * Slim test-only template. We only care about a few sentinel data-
   * testids and bucket labels in DOM assertions; the production
   * template's full markup adds noise without coverage value. The
   * component's signals/computeds are exercised through their public
   * surface either way.
   */
  const TEST_TEMPLATE = `
    @if (!connectedWallet()) {
      <div data-testid="mint-cta">connect</div>
    } @else if (state() === 'loading-utxos') {
      <div data-testid="mint-loading">loading</div>
    } @else if (utxoError(); as e) {
      <div data-testid="utxo-error">{{ e }}</div>
    } @else if (state() === 'success') {
      <div data-testid="mint-success">{{ successTxId() }}</div>
    } @else {
      <div data-testid="ready">
        <span data-testid="bucket">{{ selectedRow()?.bucket }}</span>
        <span data-testid="canmint">{{ canMint() }}</span>
        <span data-testid="funding">{{ recommendedFundingSats() }}</span>
        @if (showSmallUtxoWarning()) {<span data-testid="small-utxo">on</span>}
        @if (mintError(); as e) {<span data-testid="mint-error">{{ e }}</span>}
      </div>
    }
  `;

  /**
   * Helper: feed a list of (utxo, bucket) tuples through both the
   * orchestrator's simulations$ AND the scanner's states$ so the
   * component sees a coherent picture in one tick.
   */
  function pushRows(rows: { u: TxnOutput; scan: UtxoScanState }[]): void {
    scanner.setStates(rows.map((r) => [`${r.u.txid}:${r.u.vout}`, r.scan]));
    orch.simulationsSubject.next(rows.map((r) => ({ utxo: r.u, simulation: simulation(), insufficient: false })));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await configure();
  });

  // -------------------------------------------------------------------
  // A. Disconnected wallet
  // -------------------------------------------------------------------

  describe('A. wallet not connected', () => {
    it('A1: renders the connect CTA and nothing else', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
      expect(component.canMint()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // B. Loading state
  // -------------------------------------------------------------------

  describe('B. wallet connected, loading UTXOs', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('loading-utxos');
      fixture.detectChanges();
    });

    it('B1: shows the loading marker and hides ready / cta', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mint-loading"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeNull();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // C. Error state attribution
  // -------------------------------------------------------------------

  describe('C. error attribution (utxo-load vs mint)', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('error');
      orch.errorMessage.set('boom');
      fixture.detectChanges();
    });

    it('C1: error before mint attempt → utxoError fires', () => {
      expect(component.utxoError()).toBe('boom');
      expect(component.mintError()).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="utxo-error"]')).toBeTruthy();
    });

    it('C2: error after mint attempt → mintError fires, utxoError silenced', () => {
      // Set up a viable row so mint() can run
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
      orch.mintImpl = () => throwError(() => new Error('sign refused'));
      orch.state.set('ready');
      orch.feeRate.set(5);
      fixture.detectChanges();

      component.mint();
      orch.state.set('error');
      orch.errorMessage.set('sign refused');
      fixture.detectChanges();

      expect(component.mintError()).toBe('sign refused');
      expect(component.utxoError()).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // D. Empty-state hint + dynamic funding floor
  // -------------------------------------------------------------------

  describe('D. recommendedFundingSats — dynamic floor', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      fixture.detectChanges();
    });

    it('D1: feeRate null → falls back to 1 sat/vB → 800 sat', () => {
      expect(component.recommendedFundingSats()).toBe(800);
    });

    it('D2: feeRate=1 → 800 sat (546 + 200×1, rounded to next 100)', () => {
      orch.feeRate.set(1);
      fixture.detectChanges();
      expect(component.recommendedFundingSats()).toBe(800);
    });

    it('D3: feeRate=5 → 1600 sat (546 + 1000 = 1546 → 1600)', () => {
      orch.feeRate.set(5);
      fixture.detectChanges();
      expect(component.recommendedFundingSats()).toBe(1600);
    });

    it('D4: feeRate=100 → 20600 sat (546 + 20000 = 20546 → 20600)', () => {
      orch.feeRate.set(100);
      fixture.detectChanges();
      expect(component.recommendedFundingSats()).toBe(20600);
    });
  });

  // -------------------------------------------------------------------
  // E. Bucket-driven auto-pick
  // -------------------------------------------------------------------

  describe('E. auto-pick priority (clean → unscanned → failed; never assets)', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      fixture.detectChanges();
    });

    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    it('E1: all clean → picks the largest clean', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: big(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(80_000);
    });

    it('E2: largest is assets, second is clean → picks the clean', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [] } } },
        { u: big(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(20_000);
    });

    it('E3: all unscanned → picks largest unscanned', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'not-scanned' } },
        { u: big(20_000), scan: { kind: 'not-scanned' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(80_000);
    });

    it('E4: mixed clean+unscanned+assets → clean wins regardless of size', () => {
      pushRows([
        { u: big(90_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [] } } },
        { u: big(70_000), scan: { kind: 'not-scanned' } },
        { u: big(5_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(5_000);
    });

    it('E5: all assets → no auto-pick (selectedUtxo cleared)', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [] } } },
        { u: big(20_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'b:0', inscriptionIds: [], runes: { RUNE: {} }, catIds: [] } } },
      ]);
      expect(orch.selectedUtxo()).toBeNull();
    });

    it('E6: failed + unscanned → unscanned wins (higher priority)', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scan-failed', message: 'oops' } },
        { u: big(20_000), scan: { kind: 'not-scanned' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(20_000);
    });

    it('E7: only failed → picks the largest failed', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scan-failed', message: 'a' } },
        { u: big(20_000), scan: { kind: 'scan-failed', message: 'b' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(80_000);
    });

    it('E8: user-explicit pick survives a row re-emit if still present', () => {
      const smaller = big(20_000);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      // user picks the smaller one
      orch.setSelectedUtxo(smaller);
      // re-emit same list
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(20_000);
    });

    it('E9: user pick disappears from the list → re-picks per priority', () => {
      const gone = big(20_000);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: gone, scan: { kind: 'scanned-clean' } },
      ]);
      orch.setSelectedUtxo(gone);
      // re-emit WITHOUT the gone one
      pushRows([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      expect(orch.selectedUtxo()!.value).toBe(80_000);
    });

    it('E10: empty row list → selectedUtxo cleared', () => {
      pushRows([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      orch.simulationsSubject.next([]);
      fixture.detectChanges();
      expect(orch.selectedUtxo()).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // F. Scanner integration — autoScan + scanRow
  // -------------------------------------------------------------------

  describe('F. scanner integration', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      fixture.detectChanges();
    });

    it('F1: autoScan called with the {txid, vout, value} list every row change', () => {
      pushRows([
        { u: utxo({ txid: 'a'.repeat(64), vout: 0, value: 5_000 }), scan: { kind: 'not-scanned' } },
        { u: utxo({ txid: 'b'.repeat(64), vout: 1, value: 90_000 }), scan: { kind: 'not-scanned' } },
      ]);
      expect(scanner.autoScan).toHaveBeenCalled();
      const lastCall = (scanner.autoScan as jest.Mock).mock.calls.at(-1)![0] as { value: number }[];
      expect(lastCall.map((u) => u.value).sort()).toEqual([5_000, 90_000]);
    });

    it('F2: scanRow(row) calls scanner.scan with the outpoint string', () => {
      const u = utxo({ txid: 'c'.repeat(64), vout: 7 });
      pushRows([{ u, scan: { kind: 'not-scanned' } }]);
      component.scanRow({ utxo: u, simulation: simulation(), scan: { kind: 'not-scanned' }, bucket: 'unscanned' });
      expect(scanner.scan).toHaveBeenCalledWith(`${'c'.repeat(64)}:7`);
    });
  });

  // -------------------------------------------------------------------
  // G. Bucket label rendering / selectedRow bucket
  // -------------------------------------------------------------------

  describe('G. bucket label on selectedRow', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      fixture.detectChanges();
    });

    const u = utxo();

    it.each<[UtxoScanState['kind'], string]>([
      ['not-scanned', 'unscanned'],
      ['scanning', 'scanning'],
      ['scanned-clean', 'clean'],
      ['scan-failed', 'failed'],
    ])('G1: scan kind %s → bucket %s', (kind, bucket) => {
      const scan = kind === 'scan-failed'
        ? { kind: 'scan-failed' as const, message: 'x' }
        : { kind } as UtxoScanState;
      pushRows([{ u, scan }]);
      // 'scanning' is intentionally NOT auto-picked (we don't know
      // yet whether assets will land); force-select to inspect the
      // bucket on a selected row.
      if (kind === 'scanning') {
        orch.setSelectedUtxo(u);
        fixture.detectChanges();
      }
      expect(component.selectedRow()!.bucket).toBe(bucket);
    });

    it('G2: scanned-with-assets → bucket "assets"', () => {
      pushRows([{ u, scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['x'], runes: null, catIds: [] } } }]);
      // assets is never auto-picked; the user has to pick it themselves
      orch.setSelectedUtxo(u);
      fixture.detectChanges();
      expect(component.selectedRow()!.bucket).toBe('assets');
    });
  });

  // -------------------------------------------------------------------
  // H. canMint gating
  // -------------------------------------------------------------------

  describe('H. canMint gating', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
    });

    it('H1: viable+feeRate+selected+ready → true', () => {
      orch.feeRate.set(5);
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
      expect(component.canMint()).toBe(true);
    });

    it('H2: no viable rows → false', () => {
      orch.feeRate.set(5);
      orch.simulationsSubject.next([]);
      fixture.detectChanges();
      expect(component.canMint()).toBe(false);
    });

    it('H3: feeRate null → false', () => {
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
      orch.feeRate.set(null);
      fixture.detectChanges();
      expect(component.canMint()).toBe(false);
    });

    it('H4: selectedUtxo null → false', () => {
      orch.feeRate.set(5);
      pushRows([{ u: utxo(), scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [] } } }]);
      // auto-pick refuses assets-only, so selectedUtxo stays null
      expect(orch.selectedUtxo()).toBeNull();
      expect(component.canMint()).toBe(false);
    });

    it('H5: state=minting → false', () => {
      orch.feeRate.set(5);
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
      orch.state.set('minting');
      fixture.detectChanges();
      expect(component.canMint()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // I. showSmallUtxoWarning — single-address content-safety hint
  // -------------------------------------------------------------------

  describe('I. showSmallUtxoWarning', () => {
    beforeEach(() => {
      orch.state.set('ready');
      orch.feeRate.set(5);
    });

    it('I1: split-address wallet → never shows, even for tiny UTXOs', () => {
      orch.connectedWallet.set(wallet({
        ordinalsAddress: 'bc1p-ord',
        paymentAddress: '3-pay',
      }));
      pushRows([{ u: utxo({ value: 1_000 }), scan: { kind: 'not-scanned' } }]);
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I2: single-address + sub-10k + unscanned → shows', () => {
      orch.connectedWallet.set(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      pushRows([{ u: utxo({ value: 5_000 }), scan: { kind: 'not-scanned' } }]);
      expect(component.showSmallUtxoWarning()).toBe(true);
    });

    it('I3: single-address + sub-10k + clean → suppressed (clean takes over)', () => {
      orch.connectedWallet.set(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      pushRows([{ u: utxo({ value: 5_000 }), scan: { kind: 'scanned-clean' } }]);
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I4: single-address + sub-10k + assets → suppressed (assets-found takes over)', () => {
      orch.connectedWallet.set(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      const u = utxo({ value: 5_000 });
      pushRows([{ u, scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [] } } }]);
      orch.setSelectedUtxo(u);
      fixture.detectChanges();
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I5: single-address + >10k UTXO → suppressed (above threshold)', () => {
      orch.connectedWallet.set(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      pushRows([{ u: utxo({ value: 50_000 }), scan: { kind: 'not-scanned' } }]);
      expect(component.showSmallUtxoWarning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // J. isSingleAddressWallet detection
  // -------------------------------------------------------------------

  describe('J. isSingleAddressWallet', () => {
    it('J1: same addresses → true', () => {
      orch.connectedWallet.set(wallet({ ordinalsAddress: 'x', paymentAddress: 'x' }));
      fixture.detectChanges();
      expect(component.isSingleAddressWallet()).toBe(true);
    });

    it('J2: different addresses → false', () => {
      orch.connectedWallet.set(wallet({ ordinalsAddress: 'bc1p-x', paymentAddress: '3-y' }));
      fixture.detectChanges();
      expect(component.isSingleAddressWallet()).toBe(false);
    });

    it('J3: no wallet → false', () => {
      orch.connectedWallet.set(null);
      fixture.detectChanges();
      expect(component.isSingleAddressWallet()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // K. Mint command flow
  // -------------------------------------------------------------------

  describe('K. mint() / mintAnother()', () => {
    beforeEach(() => {
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      pushRows([{ u: utxo(), scan: { kind: 'scanned-clean' } }]);
    });

    it('K1: mint() calls orchestrator.mint and flips mintAttempted on first attempt', () => {
      component.mint();
      expect(orch.mint).toHaveBeenCalledTimes(1);
      // a subsequent error gets routed to mintError, not utxoError
      orch.state.set('error');
      orch.errorMessage.set('cancelled');
      fixture.detectChanges();
      expect(component.mintError()).toBe('cancelled');
      expect(component.utxoError()).toBeNull();
    });

    it('K2: mint() error is swallowed by the subscribe and does not throw', () => {
      orch.mintImpl = () => throwError(() => new Error('user cancelled'));
      expect(() => component.mint()).not.toThrow();
    });

    it('K3: mintAnother() resets mintAttempted and calls orchestrator.reset', () => {
      component.mint();
      orch.state.set('error');
      orch.errorMessage.set('boom');
      fixture.detectChanges();
      expect(component.mintError()).toBe('boom');

      component.mintAnother();
      expect(orch.reset).toHaveBeenCalledTimes(1);

      // After reset, a fresh utxo-load error attributes to utxoError again
      orch.state.set('error');
      orch.errorMessage.set('utxo fetch failed');
      fixture.detectChanges();
      expect(component.utxoError()).toBe('utxo fetch failed');
      expect(component.mintError()).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // L. selectUtxo + expert override
  // -------------------------------------------------------------------

  describe('L. selectUtxo (expert override)', () => {
    it('L1: clicking a row delegates to orchestrator.setSelectedUtxo', () => {
      const u = utxo({ value: 60_000 });
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      pushRows([{ u, scan: { kind: 'scanned-clean' } }]);
      orch.setSelectedUtxo.mockClear();
      component.selectUtxo({ utxo: u, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      expect(orch.setSelectedUtxo).toHaveBeenCalledWith(u);
    });

    it('L2: user can explicitly pick an assets-bearing row (override path)', () => {
      const u = utxo({ value: 5_000 });
      orch.connectedWallet.set(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      const assetsScan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: `${u.txid}:0`, inscriptionIds: ['inscription-id'], runes: null, catIds: [] } };
      pushRows([{ u, scan: assetsScan }]);
      // auto-pick refused → selectedUtxo null
      expect(orch.selectedUtxo()).toBeNull();
      // explicit override
      component.selectUtxo({ utxo: u, simulation: simulation(), scan: assetsScan, bucket: 'assets' });
      expect(orch.selectedUtxo()).toBe(u);
      expect(component.selectedRow()!.bucket).toBe('assets');
    });
  });

  // -------------------------------------------------------------------
  // M. Helper: runeNames + autoScanThreshold + toNumber
  // -------------------------------------------------------------------

  describe('M. small helpers', () => {
    it('M1: runeNames extracts keys; null runes → empty array', () => {
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [] })).toEqual([]);
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: { ALPHA: {}, BETA: {} }, catIds: [] }).sort()).toEqual(['ALPHA', 'BETA']);
    });

    it('M2: autoScanThreshold matches the SDK constant', () => {
      expect(component.autoScanThreshold).toBe(AUTO_SCAN_MAX_VALUE_SAT);
    });

    it('M3: toNumber converts bigint → number', () => {
      expect(component.toNumber(0n)).toBe(0);
      expect(component.toNumber(1234n)).toBe(1234);
    });
  });

  // -------------------------------------------------------------------
  // N. Success card
  // -------------------------------------------------------------------

  describe('N. success state', () => {
    it('N1: state=success shows the success marker with the broadcast txid', () => {
      orch.connectedWallet.set(wallet());
      orch.state.set('success');
      orch.successTxId.set('deadbeef'.repeat(8));
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const node = el.querySelector('[data-testid="mint-success"]');
      expect(node).toBeTruthy();
      expect(node!.textContent).toContain('deadbeef'.repeat(8));
    });
  });
});
