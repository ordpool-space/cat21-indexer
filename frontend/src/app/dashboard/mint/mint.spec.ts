import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  Subject,
  firstValueFrom,
  of,
  throwError,
} from 'rxjs';

import {
  AUTO_SCAN_MAX_VALUE_SAT,
  CAT21_POSTAGE_SATS,
  Cat21MintOrchestrator,
  SimulateTransactionResult,
  TxnOutput,
  UtxoContentScanner,
  UtxoScanState,
  UtxoSimulationRow,
  WalletService,
} from 'ordpool-sdk';

import { cat21Config } from '../../shared/sdk-tokens';

import { Mint } from './mint';
import { makeWallet, WalletServiceStub } from '../../testing/wallet.fixtures';

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

const wallet = makeWallet;

interface MintStubSnap {
  state: 'idle' | 'loading-utxos' | 'ready' | 'minting' | 'success' | 'error';
  feeRate: number | null;
  selectedUtxo: TxnOutput | null;
  fundingRecommendation: { status: string; recommended: TxnOutput | null; candidates: readonly unknown[] };
  simulations: UtxoSimulationRow[];
  errorMessage: string | null;
  successTxId: string | null;
}

/**
 * Snapshot-driven stand-in for the framework-agnostic Cat21MintOrchestrator.
 * The migrated component CONSTRUCTS its orchestrator (`new`); the spec
 * substitutes this stub via `{ provide: Cat21MintOrchestrator, useValue }` and
 * the component's `inject(..., { optional: true }) ??` seam picks it up. It
 * exposes the real `getSnapshot()`/`subscribe()` surface the component binds
 * to, plus signal/subject-shaped SHIMS (`state.set`, `feeRate.set`,
 * `simulationsSubject.next`, …) that funnel into `_patch`, so the test bodies
 * drive the snapshot the same way they drove the old injected stub. Wallet is
 * NOT here — the component reads it from WalletService, so tests push it via
 * `wallets.connectedWalletSubject.next(...)`.
 */
class OrchestratorStub {
  private _snap: MintStubSnap = {
    state: 'idle',
    feeRate: null,
    selectedUtxo: null,
    fundingRecommendation: { status: 'scanning', recommended: null, candidates: [] },
    simulations: [],
    errorMessage: null,
    successTxId: null,
  };
  private _listeners: Array<(s: MintStubSnap) => void> = [];

  getSnapshot(): MintStubSnap { return this._snap; }
  subscribe(l: (s: MintStubSnap) => void): () => void {
    this._listeners.push(l);
    l(this._snap);
    return () => { this._listeners = this._listeners.filter((x) => x !== l); };
  }
  private _patch(p: Partial<MintStubSnap>): void {
    this._snap = { ...this._snap, ...p };
    this._listeners.slice().forEach((l) => l(this._snap));
  }

  /** Return control for the component's `await orch.mint(prompt)`. */
  readonly mintReturn$ = new Subject<{ txId: string }>();
  mintImpl: () => Observable<{ txId: string }> = () => this.mintReturn$.asObservable();

  // Real orchestrator command surface the component calls.
  setWallet = jest.fn(async (_w: unknown) => {});
  setFeeRate = jest.fn((r: number) => this._patch({ feeRate: r }));
  // Idempotent: the component's auto-pick effect re-invokes this on every
  // snapshot change; patching only on a real change keeps the effect from
  // looping on a null → null (or same-coin) re-selection.
  setSelectedUtxo = jest.fn((u: TxnOutput | null) => {
    if (this._snap.selectedUtxo !== u) this._patch({ selectedUtxo: u });
  });
  mint = jest.fn((_prompt?: unknown) => firstValueFrom(this.mintImpl()));
  reset = jest.fn(() => this._patch({
    feeRate: null, selectedUtxo: null, errorMessage: null, successTxId: null, state: 'ready',
  }));

  // Signal/subject-shaped SHIMS the test bodies drive → `_patch`.
  readonly feeRate = { set: (v: number | null) => this._patch({ feeRate: v }) };
  readonly state = { set: (v: MintStubSnap['state']) => this._patch({ state: v }) };
  readonly successTxId = { set: (v: string | null) => this._patch({ successTxId: v }) };
  readonly errorMessage = { set: (v: string | null) => this._patch({ errorMessage: v }) };
  readonly simulationsSubject = { next: (v: UtxoSimulationRow[]) => this._patch({ simulations: v }) };
  readonly fundingRecommendationSubject = {
    next: (v: MintStubSnap['fundingRecommendation']) => this._patch({ fundingRecommendation: v }),
  };
  selectedUtxo(): TxnOutput | null { return this._snap.selectedUtxo; }
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
    // Stand in for the SDK's safe-auto recommendation so blocks that rely on
    // the auto-pick get a selection: the first content-clean covering coin
    // (status 'auto'), else a non-auto status (never auto-picks unscanned /
    // scanning / asset / failed coins). E-block overrides this via recommend().
    const clean = rows.find((r) => r.scan.kind === 'scanned-clean');
    orch.fundingRecommendationSubject.next(
      clean
        ? { status: 'auto', recommended: clean.u, candidates: [] }
        : rows.some((r) => r.scan.kind === 'not-scanned' || r.scan.kind === 'scanning')
          ? { status: 'scanning', recommended: null, candidates: [] }
          : rows.length
            ? { status: 'expert-required', recommended: null, candidates: [] }
            : { status: 'insufficient', recommended: null, candidates: [] },
    );
    fixture.detectChanges();
  }

  /** Override the SDK recommendation explicitly (E-block adoption tests). */
  function recommend(status: string, recommended: TxnOutput | null): void {
    orch.fundingRecommendationSubject.next({ status, recommended, candidates: [] });
    fixture.detectChanges();
  }

  /**
   * Simulate a DELIBERATE user pick via the real `selectUtxo` path (which marks
   * it as a user override so the auto-pick effect preserves it across
   * recommendation changes). `selectUtxo` only reads `.utxo`; the other row
   * fields are structural placeholders.
   */
  function userPick(u: TxnOutput): void {
    component.selectUtxo({ utxo: u, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' });
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
      wallets.connectedWalletSubject.next(wallet());
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
      wallets.connectedWalletSubject.next(wallet());
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

  describe('D. recommendedFundingSats — component contract (value from the SDK)', () => {
    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      fixture.detectChanges();
    });

    // The component's OWN logic is the `?? 1` fee-rate fallback plus pass-through
    // of the SDK's `calculateRecommendedFundingSats`. We assert that contract,
    // not the SDK's internal vsize/formula (the SDK owns it and may sharpen the
    // estimate), so this spec doesn't re-break when the SDK refines the number.

    it('D1: null feeRate falls back to the feeRate=1 funding (the component `?? 1` guard)', () => {
      orch.feeRate.set(1);
      fixture.detectChanges();
      const atOne = component.recommendedFundingSats();
      orch.feeRate.set(null);
      fixture.detectChanges();
      expect(component.recommendedFundingSats()).toBe(atOne);
    });

    it('D2: funding is a positive sat amount covering at least the cat postage', () => {
      orch.feeRate.set(1);
      fixture.detectChanges();
      const funding = component.recommendedFundingSats();
      expect(funding).toBeGreaterThanOrEqual(CAT21_POSTAGE_SATS);
    });

    it('D3: funding rises with the fee rate (a higher rate needs more funding)', () => {
      orch.feeRate.set(1);
      fixture.detectChanges();
      const low = component.recommendedFundingSats();
      orch.feeRate.set(100);
      fixture.detectChanges();
      expect(component.recommendedFundingSats()).toBeGreaterThan(low);
    });
  });

  // -------------------------------------------------------------------
  // E. Bucket-driven auto-pick
  // -------------------------------------------------------------------

  describe('E. auto-pick ADOPTS the SDK recommendation (no raw value-based pre-pick)', () => {
    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      fixture.detectChanges();
    });

    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    it('E1: adopts the SDK-recommended clean coin, NOT the largest by value', () => {
      // The SDK best-fit recommends the SMALLER covering coin (listed first,
      // so pushRows recommends it). The consumer must adopt exactly that; the
      // old raw value-based pre-pick would have taken the 80k (largest).
      pushRows([
        { u: big(20_000), scan: { kind: 'scanned-clean' } },
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(20_000);
      expect(orch.selectedUtxo()!.value).not.toBe(80_000);
      expect(component.fundingExpertRequired()).toBe(false);
    });

    it('E2: only asset-bearing coins cover (status expert-required) → NO auto-pick', () => {
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } } },
      ]);
      expect(orch.selectedUtxo()).toBeNull();
      expect(component.fundingExpertRequired()).toBe(true);
    });

    it('E3: unscanned coin (status scanning) → NO auto-pick (the footgun fix)', () => {
      // The old pre-pick auto-adopted an unscanned coin; the SDK never does.
      pushRows([{ u: big(80_000), scan: { kind: 'not-scanned' } }]);
      expect(orch.selectedUtxo()).toBeNull();
    });

    it('E4: scan-failed coin → NO auto-pick (the footgun fix)', () => {
      pushRows([{ u: big(80_000), scan: { kind: 'scan-failed', message: 'oops' } }]);
      expect(orch.selectedUtxo()).toBeNull();
    });

    it('E5: status auto but the recommended coin is absent from the viable rows → NO auto-pick (guard)', () => {
      // Rows have no clean coin (so pushRows recommends nothing), then the SDK
      // recommends a coin not present in this component's viable set.
      pushRows([{ u: big(80_000), scan: { kind: 'not-scanned' } }]);
      recommend('auto', big(999));
      expect(orch.selectedUtxo()).toBeNull();
    });

    it('E6: an explicit user pick survives a row re-emit if still viable', () => {
      const smaller = big(20_000);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      userPick(smaller);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: smaller, scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(20_000);
    });

    it('E7: user pick disappears from the list → re-adopts the current recommendation', () => {
      const gone = big(20_000);
      pushRows([
        { u: big(80_000), scan: { kind: 'scanned-clean' } },
        { u: gone, scan: { kind: 'scanned-clean' } },
      ]);
      userPick(gone);
      // Re-emit WITHOUT the gone one; pushRows now recommends the clean 80k.
      pushRows([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      expect(orch.selectedUtxo()!.value).toBe(80_000);
    });

    it('E8: empty row list → selectedUtxo cleared', () => {
      pushRows([{ u: big(80_000), scan: { kind: 'scanned-clean' } }]);
      orch.simulationsSubject.next([]);
      orch.fundingRecommendationSubject.next({ status: 'insufficient', recommended: null, candidates: [] });
      fixture.detectChanges();
      expect(orch.selectedUtxo()).toBeNull();
    });

    it('E9: fee-rate change RE-ADOPTS the recommendation, never keeps a stale AUTO-pick (the 2026-08-31 regtest false-red)', () => {
      // The regtest picker auto-seeds fastestFee=5, then the user types 100. At the
      // seed rate the SDK recommends the smallest headroom coin (13689 — a dust-cliff
      // coin at rate 100); at rate 100 it recommends a real headroom coin (99301).
      // The component must follow the rate-100 recommendation, not keep the stale
      // rate-5 AUTO-pick (which mints at 107.7 sat/vB for a typed 100). An explicit
      // user pick still survives (E6); an auto-pick does not.
      const c100k = big(100_000), c99301 = big(99_301), c13689 = big(13_689);
      orch.feeRate.set(5); // auto-seed
      // 13689 listed first so pushRows' first-clean recommendation is the SDK's
      // rate-5 pick (the smallest headroom coin).
      pushRows([
        { u: c13689, scan: { kind: 'scanned-clean' } },
        { u: c99301, scan: { kind: 'scanned-clean' } },
        { u: c100k, scan: { kind: 'scanned-clean' } },
      ]);
      expect(orch.selectedUtxo()!.value).toBe(13_689);
      // user types 100 -> SDK re-recommends the headroom coin
      orch.feeRate.set(100);
      recommend('auto', c99301);
      expect(orch.selectedUtxo()!.value).toBe(99_301);
    });
  });

  // -------------------------------------------------------------------
  // F. Scanner integration — autoScan + scanRow
  // -------------------------------------------------------------------

  describe('F. scanner integration', () => {
    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
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
      wallets.connectedWalletSubject.next(wallet());
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
      // Only a content-clean coin is auto-picked now (via the SDK's
      // fundingRecommendation$); every non-clean kind is left for a deliberate
      // pick, so force-select to inspect the bucket on a selected row.
      if (kind !== 'scanned-clean') {
        userPick(u);
        fixture.detectChanges();
      }
      expect(component.selectedRow()!.bucket).toBe(bucket);
    });

    it('G2: scanned-with-assets → bucket "assets"', () => {
      pushRows([{ u, scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['x'], runes: null, catIds: [], catSat: null, rareSat: null } } }]);
      // assets is never auto-picked; the user has to pick it themselves
      userPick(u);
      fixture.detectChanges();
      expect(component.selectedRow()!.bucket).toBe('assets');
    });
  });

  // -------------------------------------------------------------------
  // H. canMint gating
  // -------------------------------------------------------------------

  describe('H. canMint gating', () => {
    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
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
      pushRows([{ u: utxo(), scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } } }]);
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
      wallets.connectedWalletSubject.next(wallet({
        ordinalsAddress: 'bc1p-ord',
        paymentAddress: '3-pay',
      }));
      pushRows([{ u: utxo({ value: 1_000 }), scan: { kind: 'not-scanned' } }]);
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I2: single-address + sub-10k + unscanned → shows', () => {
      wallets.connectedWalletSubject.next(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      const u = utxo({ value: 5_000 });
      pushRows([{ u, scan: { kind: 'not-scanned' } }]);
      // Unscanned coins are no longer auto-picked; the user picks it (expert
      // mode) and only then does the small-UTXO safety warning apply.
      userPick(u);
      fixture.detectChanges();
      expect(component.showSmallUtxoWarning()).toBe(true);
    });

    it('I3: single-address + sub-10k + clean → suppressed (clean takes over)', () => {
      wallets.connectedWalletSubject.next(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      pushRows([{ u: utxo({ value: 5_000 }), scan: { kind: 'scanned-clean' } }]);
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I4: single-address + sub-10k + assets → suppressed (assets-found takes over)', () => {
      wallets.connectedWalletSubject.next(wallet({
        ordinalsAddress: 'same-addr',
        paymentAddress: 'same-addr',
      }));
      const u = utxo({ value: 5_000 });
      pushRows([{ u, scan: { kind: 'scanned-with-assets', content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } } }]);
      userPick(u);
      fixture.detectChanges();
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I5: single-address + >10k UTXO → suppressed (above threshold)', () => {
      wallets.connectedWalletSubject.next(wallet({
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
      wallets.connectedWalletSubject.next(wallet({ ordinalsAddress: 'x', paymentAddress: 'x' }));
      fixture.detectChanges();
      expect(component.isSingleAddressWallet()).toBe(true);
    });

    it('J2: different addresses → false', () => {
      wallets.connectedWalletSubject.next(wallet({ ordinalsAddress: 'bc1p-x', paymentAddress: '3-y' }));
      fixture.detectChanges();
      expect(component.isSingleAddressWallet()).toBe(false);
    });

    it('J3: no wallet → false', () => {
      wallets.connectedWalletSubject.next(null);
      fixture.detectChanges();
      expect(component.isSingleAddressWallet()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // K. Mint command flow
  // -------------------------------------------------------------------

  describe('K. mint() / mintAnother()', () => {
    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
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
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      pushRows([{ u, scan: { kind: 'scanned-clean' } }]);
      orch.setSelectedUtxo.mockClear();
      component.selectUtxo({ utxo: u, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      expect(orch.setSelectedUtxo).toHaveBeenCalledWith(u);
    });

    it('L2: user can explicitly pick an assets-bearing row (override path)', () => {
      const u = utxo({ value: 5_000 });
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
      const assetsScan: UtxoScanState = { kind: 'scanned-with-assets', content: { outpoint: `${u.txid}:0`, inscriptionIds: ['inscription-id'], runes: null, catIds: [], catSat: null, rareSat: null } };
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
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [], catSat: null, rareSat: null })).toEqual([]);
      expect(component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: { ALPHA: {}, BETA: {} }, catIds: [], catSat: null, rareSat: null }).sort()).toEqual(['ALPHA', 'BETA']);
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
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('success');
      orch.successTxId.set('deadbeef'.repeat(8));
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const node = el.querySelector('[data-testid="mint-success"]');
      expect(node).toBeTruthy();
      expect(node!.textContent).toContain('deadbeef'.repeat(8));
    });
  });

  // -------------------------------------------------------------------
  // MATRIX section — IDs come from `/Work/ordpool/PLAN-mint-test-matrix.md`
  // and stay stable across both spec files. The "B" suffix means "both
  // sites carry the same assertion"; grep MATRIX-A5 to find the paired
  // copy in ordpool's cat21-mint.component.spec.ts.
  // -------------------------------------------------------------------

  describe('MATRIX-A. wallet lifecycle', () => {
    it('MATRIX-A5(B): wallet swap resets scanner', () => {
      const w1 = wallet({ ordinalsAddress: 'addr-1', paymentAddress: 'pay-1' });
      const w2 = wallet({ ordinalsAddress: 'addr-2', paymentAddress: 'pay-2' });
      // First connect → no reset (initial null → wallet)
      wallets.connectedWalletSubject.next(w1);
      fixture.detectChanges();
      scanner.reset.mockClear();
      // Swap → reset fires
      wallets.connectedWalletSubject.next(w2);
      fixture.detectChanges();
      expect(scanner.reset).toHaveBeenCalledTimes(1);
    });

    it('MATRIX-A6(B): initial null → wallet emission does NOT reset the scanner', () => {
      scanner.reset.mockClear();
      wallets.connectedWalletSubject.next(wallet());
      fixture.detectChanges();
      expect(scanner.reset).not.toHaveBeenCalled();
    });

    it('MATRIX-A9(B): disconnect returns to idle state', () => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      fixture.detectChanges();
      wallets.connectedWalletSubject.next(null);
      orch.state.set('idle');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
    });
  });

  describe('MATRIX-B. fee-rate-driven viability', () => {
    it('MATRIX-B14(B): recommendedFundingSats increases strictly across 1/5/50/100 sat/vB', () => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      // Pin the component contract (strictly rising with the fee rate), not the
      // SDK's exact vsize output — same reasoning as the D-block.
      const values = [1, 5, 50, 100].map((rate) => {
        orch.feeRate.set(rate);
        fixture.detectChanges();
        return component.recommendedFundingSats();
      });
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    });

    it('MATRIX-B15(B): feeRate=null yields the same funding as feeRate=1 (the `?? 1` fallback)', () => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      orch.feeRate.set(1);
      fixture.detectChanges();
      const atOne = component.recommendedFundingSats();
      orch.feeRate.set(null);
      fixture.detectChanges();
      expect(component.recommendedFundingSats()).toBe(atOne);
    });
  });

  describe('MATRIX-D. bucket-driven UI', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
    });

    it('MATRIX-D15(B): viable row list is capped at 10 entries', () => {
      const rows = Array.from({ length: 25 }, (_, i) => ({
        u: big(50_000 + i),
        scan: { kind: 'scanned-clean' } as UtxoScanState,
      }));
      pushRows(rows);
      expect(component.viableRows().length).toBe(10);
    });

    it('MATRIX-D16(B): viable rows sorted strictly descending by UTXO value', () => {
      pushRows([
        { u: big(10_000), scan: { kind: 'scanned-clean' } },
        { u: big(50_000), scan: { kind: 'scanned-clean' } },
        { u: big(30_000), scan: { kind: 'scanned-clean' } },
      ]);
      const values = component.viableRows().map((r) => r.utxo.value);
      expect(values).toEqual([50_000, 30_000, 10_000]);
    });
  });

  describe('MATRIX-E. expert-panel visibility (THE 2026-06-12 regression group)', () => {
    const big = (v: number) => utxo({ txid: String(v).repeat(64).slice(0, 64), value: v });

    beforeEach(() => {
      wallets.connectedWalletSubject.next(wallet());
      orch.state.set('ready');
      orch.feeRate.set(5);
    });

    it('MATRIX-E1(B): expert panel renders when viableRows > 0 AND a row is selected (baseline)', () => {
      pushRows([{ u: big(50_000), scan: { kind: 'scanned-clean' } }]);
      const el: HTMLElement = fixture.nativeElement;
      expect(component.viableRows().length).toBeGreaterThan(0);
      expect(component.selectedRow()).not.toBeNull();
      // The slim test template doesn't render the <details>; we verify
      // via the component state that drives it.
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E2(B): **THE REGRESSION** — expert panel must render when viableRows > 0 even if selectedRow is null (assets-only case)', () => {
      // assets-only scenario: auto-pick refuses, selectedUtxo stays null,
      // but the user MUST still see the panel to override with "Use anyway".
      const assetsScan: UtxoScanState = {
        kind: 'scanned-with-assets',
        content: { outpoint: 'x:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null },
      };
      pushRows([{ u: big(50_000), scan: assetsScan }]);
      expect(component.viableRows().length).toBeGreaterThan(0);
      expect(component.selectedRow()).toBeNull();
      // The panel must be open-by-default in this exact case (no other
      // way for the user to make a decision).
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E3(B): expert panel logic skips render when there are no viable rows', () => {
      // No simulations emitted → viableRows is empty
      orch.simulationsSubject.next([]);
      fixture.detectChanges();
      expect(component.viableRows().length).toBe(0);
      // pickerOpenByDefault returns false in this case (no rows to show);
      // the template gates the @if on viableRows().length > 0.
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E4(C): pickerOpenByDefault is true when no row is auto-selected', () => {
      // Only-assets scenario triggers no auto-pick
      pushRows([{
        u: big(50_000),
        scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } },
      }]);
      expect(component.selectedRow()).toBeNull();
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E5(C): pickerOpenByDefault is true when selected bucket is "assets"', () => {
      // Multiple rows, auto-pick refuses, user explicitly picks an
      // assets row → panel should stay open by default until the
      // user toggles it closed.
      const u1 = big(50_000);
      const assetsScan: UtxoScanState = {
        kind: 'scanned-with-assets',
        content: { outpoint: `${u1.txid}:0`, inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null },
      };
      pushRows([{ u: u1, scan: assetsScan }]);
      userPick(u1);
      fixture.detectChanges();
      expect(component.selectedRow()!.bucket).toBe('assets');
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E6(C): pickerOpenByDefault is true when selected bucket is "failed"', () => {
      const u = big(50_000);
      pushRows([{ u, scan: { kind: 'scan-failed', message: 'oops' } }]);
      // scan-failed coins are not auto-picked; the user picks it (expert mode).
      userPick(u);
      fixture.detectChanges();
      expect(component.selectedRow()!.bucket).toBe('failed');
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E7(C): pickerOpenByDefault is false when selected bucket is "clean" (happy path)', () => {
      pushRows([{ u: big(50_000), scan: { kind: 'scanned-clean' } }]);
      expect(component.selectedRow()!.bucket).toBe('clean');
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E8(C): pickerOpenByDefault is false when selected bucket is "unscanned" (probably-safe path)', () => {
      const u = big(80_000);
      pushRows([{ u, scan: { kind: 'not-scanned' } }]);
      // Unscanned coins are not auto-picked; the user picks it (expert mode).
      userPick(u);
      fixture.detectChanges();
      expect(component.selectedRow()!.bucket).toBe('unscanned');
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E9(B): panel state survives a fee-rate change that keeps viable rows > 0', () => {
      pushRows([{ u: big(50_000), scan: { kind: 'scanned-clean' } }]);
      const beforeRows = component.viableRows().length;
      // Bump the rate but keep the UTXO viable
      orch.feeRate.set(10);
      pushRows([{ u: big(50_000), scan: { kind: 'scanned-clean' } }]);
      expect(component.viableRows().length).toBe(beforeRows);
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E10(B): summary panel is hidden when no row is selected', () => {
      pushRows([{
        u: big(50_000),
        scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } },
      }]);
      expect(component.selectedRow()).toBeNull();
      const el: HTMLElement = fixture.nativeElement;
      // In the slim test template the summary section isn't rendered,
      // but canMint must be false (the production template gates the
      // mint button on canMint).
      expect(component.canMint()).toBe(false);
    });

    it('MATRIX-E11(B): mint button disabled when there is no row selection', () => {
      pushRows([{
        u: big(50_000),
        scan: { kind: 'scanned-with-assets', content: { outpoint: 'a:0', inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null } },
      }]);
      expect(orch.selectedUtxo()).toBeNull();
      expect(component.canMint()).toBe(false);
    });

    it('MATRIX-E12(B): mint button re-enables after the user explicitly picks an assets row ("Use anyway")', () => {
      const u1 = big(50_000);
      const assetsScan: UtxoScanState = {
        kind: 'scanned-with-assets',
        content: { outpoint: `${u1.txid}:0`, inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null },
      };
      pushRows([{ u: u1, scan: assetsScan }]);
      // Pre: auto-pick refuses, mint disabled
      expect(component.canMint()).toBe(false);
      // Explicit override
      component.selectUtxo({ utxo: u1, simulation: simulation(), scan: assetsScan, bucket: 'assets' });
      expect(component.canMint()).toBe(true);
    });
  });

  describe('MATRIX-I. edge cases', () => {
    it('MATRIX-I20(B): runeNames returns [] for null runes (no crash)', () => {
      const empty = component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [], catSat: null, rareSat: null });
      expect(empty).toEqual([]);
    });

    it('MATRIX-I21(B): bucketTooltip returns a non-empty string for every bucket kind (no undefined flicker)', () => {
      const buckets = ['clean', 'unscanned', 'assets', 'scanning', 'failed'] as const;
      for (const b of buckets) {
        const tip = component.bucketTooltip(b);
        expect(typeof tip).toBe('string');
        expect(tip.length).toBeGreaterThan(0);
      }
    });
  });
});
