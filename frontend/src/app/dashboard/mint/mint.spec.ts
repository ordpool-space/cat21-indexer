/**
 * @test-kind unit
 * Real:   Mint component; the SDK Cat21MintOrchestrator (fee simulation, funding recommendation with the
 *         'derive' topology, build, sign and broadcast run for real against wallets whose keys the spec holds)
 * Faked:  orchestrator ports (testing/orchestrator-ports.fixtures): getUtxos -> the electrs UTXO list the spec sets,
 *         scan.classify -> the ord/cat21-ord verdict the spec sets per outpoint (UtxoClassification shape),
 *         broadcast -> the txid of the tx it is handed (electrs POST /tx shape)
 *         window.Cat21Provider (the wallet API) -> installFakeCat21Provider, signing with the test wallet's keys
 *         UtxoContentScanner -> ScannerStub (testing/scanner.fixtures), set consistently with the port verdicts
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         E5 only: one snapshot pushed through the component's own subscription, the real orchestrator's
 *         with fundingRecommendation replaced by a coin that has no row (a state the SDK does not produce)
 * Proves: the mint page renders each orchestrator state (no wallet, loading, utxo error vs mint error, funding
 *         states, success), spends the SDK's resolved coin (the recommendation on auto and asset-notice, a
 *         deliberate pick while it covers), and wires its controls
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  AUTO_SCAN_MAX_VALUE_SAT,
  CAT21_POSTAGE_SATS,
  Cat21MintOrchestrator,
  MintSnapshot,
  SimulateTransactionResult,
  TxnOutput,
  UtxoClassification,
  UtxoContent,
  UtxoContentScanner,
  UtxoScanState,
  WalletInfo,
  WalletService,
} from 'ordpool-sdk';

import { cat21Config } from '../../shared/sdk-tokens';

import { Mint } from './mint';
import { WalletServiceStub } from '../../testing/wallet.fixtures';
import { ScannerStub } from '../../testing/scanner.fixtures';
import { FakePorts, assetsVerdict, fakePorts } from '../../testing/orchestrator-ports.fixtures';
import {
  fundingCoin,
  installFakeCat21Provider,
  oneAddressTestWallet,
  testWallet,
} from '../../testing/test-wallet.fixtures';

// ---------------------------------------------------------------------------
// Fixture builders. A coin is a real electrs UTXO at the test wallet's payment
// address; `scan` is what the page's scanner shows for it, and the port
// verdict the orchestrator's force-scan reads is derived from it (below).
// ---------------------------------------------------------------------------

/** A coin with a value-derived txid, so equal values name the same coin across calls. */
const coin = (v: number): TxnOutput => ({ ...fundingCoin(v, 1), txid: String(v).repeat(64).slice(0, 64) });

/** A row the component reads `.utxo` from; the simulation fields are structural placeholders. */
function simulation(): SimulateTransactionResult {
  return {
    finalTransactionFee: 200n,
    amountToRecipient: 546n,
    singleInputAmount: 50_000n,
    changeAmount: 49_254n,
    vsize: 150,
    tx: {} as SimulateTransactionResult['tx'],
  };
}

const inscribed = (outpoint: string): UtxoContent =>
  ({ outpoint, inscriptionIds: ['i'], runes: null, catIds: [], catSat: null, rareSat: null });

const assetsScan = (u: TxnOutput): UtxoScanState =>
  ({ kind: 'scanned-with-assets', content: inscribed(`${u.txid}:${u.vout}`) });

/**
 * The verdict the orchestrator's own scan reaches for a coin the page shows as
 * `scan`. A clean or asset-bearing scan reports the same; a failed scan
 * rejects. `not-scanned` / `scanning` describe the page's scanner only: the
 * orchestrator force-scans every covering coin itself (above the auto-scan
 * ceiling the page never scans unasked), so its verdict there is the coin's
 * content, clean unless a test says otherwise.
 */
function verdictFor(scan: UtxoScanState): UtxoClassification | Error {
  switch (scan.kind) {
    case 'scanned-with-assets':
      return assetsVerdict({ inscriptionIds: scan.content.inscriptionIds });
    case 'scan-failed':
      return new Error(scan.message);
    default:
      return 'clean';
  }
}

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

describe('Mint component (cat21.space /dashboard/mint)', () => {
  let ports: FakePorts;
  let orch: Cat21MintOrchestrator;
  let scanner: ScannerStub;
  let wallets: WalletServiceStub;
  let fixture: ComponentFixture<Mint>;
  let component: Mint;
  let snapshotListener: (s: MintSnapshot) => void;
  let provider: ReturnType<typeof installFakeCat21Provider> | null = null;

  async function configure(): Promise<void> {
    ports = fakePorts();
    orch = new Cat21MintOrchestrator(ports);
    const subscribeSpy = jest.spyOn(orch, 'subscribe');
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
      // Mint imports FeesPicker + WalletConnect; the slim template keeps the
      // sentinel testids this spec reads.
      .overrideComponent(Mint, {
        set: { imports: [], template: TEST_TEMPLATE, schemas: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(Mint);
    component = fixture.componentInstance;
    snapshotListener = subscribeSpy.mock.calls[0]![0];
    fixture.detectChanges();
  }

  /** Let effects, the orchestrator's async load/recompute and change detection settle. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 0));
    }
    fixture.detectChanges();
  }

  /** Stage what electrs, ord and the page's scanner report for these coins. */
  function stage(rows: { u: TxnOutput; scan: UtxoScanState }[]): void {
    scanner.setStates(rows.map((r) => [`${r.u.txid}:${r.u.vout}`, r.scan]));
    for (const r of rows) ports.setVerdict(`${r.u.txid}:${r.u.vout}`, verdictFor(r.scan));
    ports.setCoins(rows.map((r) => r.u));
  }

  /** Connect `w`, set the fee rate, and let the orchestrator price `rows`. */
  async function ready(rows: { u: TxnOutput; scan: UtxoScanState }[], w: WalletInfo = testWallet(), rate = 5): Promise<void> {
    stage(rows);
    wallets.connectedWalletSubject.next(w);
    await settle();
    component.onFeeRateChange(rate);
    await settle();
  }

  /** New electrs answer for the connected wallet (a re-read of its UTXO set). */
  async function pushRows(rows: { u: TxnOutput; scan: UtxoScanState }[]): Promise<void> {
    stage(rows);
    await orch.refreshUtxos();
    await settle();
  }

  /** A DELIBERATE user pick via the real `selectUtxo` path; only `.utxo` is read. */
  async function userPick(u: TxnOutput): Promise<void> {
    component.selectUtxo({ utxo: u, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' });
    await settle();
  }

  /** The coin the mint spends, as the page reads it (the snapshot's `resolvedFundingUtxo`). */
  const selected = () => component.resolvedFundingUtxo();

  beforeEach(async () => {
    await configure();
  });

  afterEach(() => {
    provider?.restore();
    provider = null;
  });

  // -------------------------------------------------------------------
  // A. Disconnected wallet: only the connect CTA.
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
  // B. Loading: electrs has not answered yet.
  // -------------------------------------------------------------------

  describe('B. wallet connected, loading UTXOs', () => {
    it('B1: shows the loading marker and hides ready / cta', async () => {
      const held = ports.holdUtxos();
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      const el: HTMLElement = fixture.nativeElement;
      expect(component.state()).toBe('loading-utxos');
      expect(el.querySelector('[data-testid="mint-loading"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeNull();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
      held.release();
    });
  });

  // -------------------------------------------------------------------
  // C. Error attribution: a failed UTXO load is utxoError, a failed mint
  //    is mintError, never both.
  // -------------------------------------------------------------------

  describe('C. error attribution (utxo-load vs mint)', () => {
    it('C1: error before mint attempt → utxoError fires', async () => {
      const held = ports.holdUtxos();
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      held.fail(new Error('boom'));
      await settle();

      expect(component.utxoError()).toBe('Failed to load UTXOs: boom');
      expect(component.mintError()).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="utxo-error"]')).toBeTruthy();
    });

    it('C2: error after mint attempt → mintError fires, utxoError silenced', async () => {
      provider = installFakeCat21Provider();
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      provider.rejectWith(new Error('sign refused'));

      await component.mint();
      await settle();

      expect(component.state()).toBe('error');
      expect(component.mintError()).toBe('sign refused');
      expect(component.utxoError()).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // D. recommendedFundingSats: the component's `?? 1` fee-rate fallback
  //    over the SDK's calculateRecommendedFundingSats (contract, not the
  //    SDK's formula).
  // -------------------------------------------------------------------

  describe('D. recommendedFundingSats — component contract (value from the SDK)', () => {
    beforeEach(async () => {
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
    });

    it('D1: null feeRate falls back to the feeRate=1 funding (the component `?? 1` guard)', async () => {
      expect(component.feeRate()).toBeNull();
      const atNull = component.recommendedFundingSats();
      component.onFeeRateChange(1);
      await settle();
      expect(component.recommendedFundingSats()).toBe(atNull);
    });

    it('D2: funding is a positive sat amount covering at least the cat postage', async () => {
      component.onFeeRateChange(1);
      await settle();
      expect(component.recommendedFundingSats()).toBeGreaterThanOrEqual(CAT21_POSTAGE_SATS);
    });

    it('D3: funding rises with the fee rate (a higher rate needs more funding)', async () => {
      component.onFeeRateChange(1);
      await settle();
      const low = component.recommendedFundingSats();
      component.onFeeRateChange(100);
      await settle();
      expect(component.recommendedFundingSats()).toBeGreaterThan(low);
    });
  });

  // -------------------------------------------------------------------
  // E. The coin the mint spends is the SDK's resolution: the recommendation
  //    on 'auto' and 'asset-notice', never a raw value-based pre-pick, and a
  //    deliberate pick while it still covers.
  // -------------------------------------------------------------------

  describe('E. the spend coin is the SDK resolution (no raw value-based pre-pick)', () => {
    it('E1: spends the SDK-recommended clean coin, NOT the largest by value', async () => {
      // The SDK best-fit recommends the SMALLER covering coin; a raw
      // value-based pre-pick would take the 80k.
      await ready([
        { u: coin(20_000), scan: { kind: 'scanned-clean' } },
        { u: coin(80_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(selected()!.value).toBe(20_000);
      expect(component.fundingExpertRequired()).toBe(false);
    });

    it('E2: only asset-bearing coins cover on a one-address wallet → SDK derives expert-required, NO auto-pick, CTA blocked', async () => {
      // The asset-to-miner ruling's one-address branch, derived for real: the
      // orchestrator resolves the 'derive' topology from the connected wallet
      // (payment address == ordinals address) and answers expert-required.
      await ready([{ u: coin(80_000), scan: assetsScan(coin(80_000)) }], oneAddressTestWallet());
      expect(component.debugFunding().status).toBe('expert-required');
      expect(selected()).toBeNull();
      expect(component.fundingExpertRequired()).toBe(true);
      expect(component.canMint()).toBe(false);
    });

    it('E2b: a dirty coin covers on a separate-address wallet → SDK derives asset-notice, spends it, CTA enabled', async () => {
      // The separate-address branch: no clean coin covers, a dirty one does,
      // so the SDK NOTICEs and resolves to the coin. The page reads it, or the
      // notice (nested in the selected-row block) never renders.
      const c = coin(80_000);
      await ready([{ u: c, scan: assetsScan(c) }], testWallet());
      expect(component.assetNotice()).toBe(true);
      expect(selected()!.txid).toBe(c.txid);
      expect(component.noticeAssets()).toEqual({ inscriptionIds: ['i'], runeNames: [], catIds: [], rareSat: null });
      expect(component.fundingExpertRequired()).toBe(false);
      expect(component.canMint()).toBe(true);
    });

    it('E3: a coin whose content scan has not answered → no rows, NO auto-pick', async () => {
      // The orchestrator force-scans before it prices anything, so a pending
      // scan yields no recommendation and no row to adopt.
      ports.scan.classify.mockImplementation(() => new Promise<UtxoClassification>(() => undefined));
      stage([{ u: coin(80_000), scan: { kind: 'scanning' } }]);
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      component.onFeeRateChange(5);
      await settle();
      expect(ports.scan.classify).toHaveBeenCalledWith(`${coin(80_000).txid}:0`);
      expect(component.viableRows()).toEqual([]);
      expect(selected()).toBeNull();
    });

    it('E4: scan-failed coin on a one-address wallet → NO auto-pick', async () => {
      // A failed scan is unknown content, never clean: blocked on a one-address wallet.
      await ready([{ u: coin(80_000), scan: { kind: 'scan-failed', message: 'oops' } }], oneAddressTestWallet());
      expect(component.debugFunding().status).toBe('expert-required');
      expect(selected()).toBeNull();
    });

    it('E5: status auto but the recommended coin is absent from the viable rows → NO auto-pick (guard)', async () => {
      // The real orchestrator never recommends a coin it did not price, so this
      // guard is reached with a SYNTHETIC snapshot: the real one with only the
      // recommendation replaced, pushed through the component's own
      // subscription. Everything else stays the real orchestrator's.
      await ready([{ u: coin(80_000), scan: assetsScan(coin(80_000)) }], oneAddressTestWallet());
      expect(selected()).toBeNull();
      const absent = coin(999);
      const setSelected = jest.spyOn(orch, 'setSelectedUtxo');
      snapshotListener({ ...orch.getSnapshot(), fundingRecommendation: { status: 'auto', recommended: { ...absent, bucket: 'clean' }, candidates: [] } });
      await settle();
      // The component never hands the orchestrator a coin it has no row for.
      expect(setSelected.mock.calls.map(([u]) => u?.txid ?? null)).not.toContain(absent.txid);
      expect(selected()).toBeNull();
    });

    it('E6: an explicit user pick survives a row re-emit if still viable', async () => {
      const bigger = coin(80_000);
      await ready([
        { u: bigger, scan: { kind: 'scanned-clean' } },
        { u: coin(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(selected()!.value).toBe(20_000); // the SDK's pick
      await userPick(bigger);
      await pushRows([
        { u: bigger, scan: { kind: 'scanned-clean' } },
        { u: coin(20_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(selected()!.value).toBe(80_000);
    });

    it('E7: user pick disappears from the list → spends the current recommendation, the drop is named', async () => {
      const gone = coin(20_000);
      await ready([
        { u: coin(80_000), scan: { kind: 'scanned-clean' } },
        { u: gone, scan: { kind: 'scanned-clean' } },
      ]);
      await userPick(gone);
      await pushRows([{ u: coin(80_000), scan: { kind: 'scanned-clean' } }]);
      expect(selected()!.value).toBe(80_000);
      expect(component.droppedSelection()).toEqual({ txid: gone.txid, vout: gone.vout, reason: 'gone' });
    });

    it('E8: empty row list → no spend coin', async () => {
      await ready([{ u: coin(80_000), scan: { kind: 'scanned-clean' } }]);
      expect(selected()).not.toBeNull();
      await pushRows([]);
      expect(component.debugFunding().status).toBe('insufficient');
      expect(selected()).toBeNull();
    });

    it('E9: fee-rate change follows the recommendation when nothing was picked', async () => {
      // At rate 5 the SDK recommends the smallest headroom coin (13 689); at
      // rate 100 that coin is a dust-cliff coin and the SDK recommends a real
      // headroom coin. The spend coin follows; only an explicit pick survives (E6).
      await ready([
        { u: coin(13_689), scan: { kind: 'scanned-clean' } },
        { u: coin(99_301), scan: { kind: 'scanned-clean' } },
        { u: coin(100_000), scan: { kind: 'scanned-clean' } },
      ], testWallet(), 5);
      expect(selected()!.value).toBe(13_689);
      component.onFeeRateChange(100);
      await settle();
      const recommended = orch.getSnapshot().fundingRecommendation.recommended;
      expect(recommended!.value).not.toBe(13_689);
      expect(selected()!.value).toBe(recommended!.value);
    });
  });

  // -------------------------------------------------------------------
  // F. Scanner integration: autoScan on every row change, scanRow by outpoint.
  // -------------------------------------------------------------------

  describe('F. scanner integration', () => {
    it('F1: autoScan called with the {txid, vout, value} list every row change', async () => {
      await ready([
        { u: { ...fundingCoin(5_000, 0xa1), vout: 0 }, scan: { kind: 'not-scanned' } },
        { u: { ...fundingCoin(90_000, 0xb1), vout: 1 }, scan: { kind: 'not-scanned' } },
      ]);
      expect(scanner.autoScan).toHaveBeenCalled();
      const lastCall = (scanner.autoScan as jest.Mock).mock.calls.at(-1)![0] as { value: number }[];
      expect(lastCall.map((u) => u.value).sort()).toEqual([5_000, 90_000]);
    });

    it('F2: scanRow(row) calls scanner.scan with the outpoint string', async () => {
      const u = fundingCoin(60_000, 0xc1, 7);
      await ready([{ u, scan: { kind: 'not-scanned' } }]);
      component.scanRow({ utxo: u, simulation: simulation(), scan: { kind: 'not-scanned' }, bucket: 'unscanned' });
      expect(scanner.scan).toHaveBeenCalledWith(`${u.txid}:7`);
    });
  });

  // -------------------------------------------------------------------
  // G. The selected row carries the page scanner's bucket.
  // -------------------------------------------------------------------

  describe('G. bucket label on selectedRow', () => {
    const u = coin(50_000);

    it.each<[UtxoScanState['kind'], string]>([
      ['not-scanned', 'unscanned'],
      ['scanning', 'scanning'],
      ['scanned-clean', 'clean'],
      ['scan-failed', 'failed'],
    ])('G1: scan kind %s → bucket %s', async (kind, bucket) => {
      const scan = kind === 'scan-failed'
        ? { kind: 'scan-failed' as const, message: 'x' }
        : { kind } as UtxoScanState;
      await ready([{ u, scan }]);
      if (kind !== 'scanned-clean') await userPick(u);
      expect(component.selectedRow()!.bucket).toBe(bucket);
    });

    it('G2: scanned-with-assets → bucket "assets"', async () => {
      await ready([{ u, scan: assetsScan(u) }], oneAddressTestWallet());
      // assets is never auto-picked on a one-address wallet; the user picks it
      await userPick(u);
      expect(component.selectedRow()!.bucket).toBe('assets');
    });
  });

  // -------------------------------------------------------------------
  // H. canMint gating: viable rows, fee rate, a selection, state ready.
  // -------------------------------------------------------------------

  describe('H. canMint gating', () => {
    it('H1: viable+feeRate+selected+ready → true', async () => {
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      expect(component.canMint()).toBe(true);
    });

    it('H2: no viable rows → false', async () => {
      await ready([]);
      expect(component.viableRows()).toEqual([]);
      expect(component.canMint()).toBe(false);
    });

    it('H3: feeRate null → false', async () => {
      // The fee rate becomes null again through "mint another" (orchestrator reset).
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      component.mintAnother();
      await settle();
      expect(component.feeRate()).toBeNull();
      expect(component.canMint()).toBe(false);
    });

    it('H4: no spend coin → false', async () => {
      await ready([{ u: coin(50_000), scan: assetsScan(coin(50_000)) }], oneAddressTestWallet());
      // the SDK refuses assets-only on a one-address wallet, so no coin is spent
      expect(component.viableRows().length).toBe(1);
      expect(selected()).toBeNull();
      expect(component.canMint()).toBe(false);
    });

    it('H5: state=minting → false', async () => {
      provider = installFakeCat21Provider();
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      // A broadcast that never answers holds the orchestrator in 'minting'.
      ports.broadcast.mockImplementation(() => new Promise<string>(() => undefined));
      void component.mint();
      await settle();
      expect(component.state()).toBe('minting');
      expect(component.canMint()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // I. showSmallUtxoWarning: single-address wallet, sub-10k, content unknown.
  // -------------------------------------------------------------------

  describe('I. showSmallUtxoWarning', () => {
    it('I1: split-address wallet → never shows, even for tiny UTXOs', async () => {
      const u = coin(5_000);
      await ready([{ u, scan: { kind: 'not-scanned' } }], testWallet());
      await userPick(u);
      expect(component.selectedRow()).not.toBeNull();
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I2: single-address + sub-10k + unscanned → shows', async () => {
      const u = coin(5_000);
      await ready([{ u, scan: { kind: 'not-scanned' } }], oneAddressTestWallet());
      await userPick(u);
      expect(component.showSmallUtxoWarning()).toBe(true);
    });

    it('I3: single-address + sub-10k + clean → suppressed (clean takes over)', async () => {
      await ready([{ u: coin(5_000), scan: { kind: 'scanned-clean' } }], oneAddressTestWallet());
      expect(component.selectedRow()!.bucket).toBe('clean');
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I4: single-address + sub-10k + assets → suppressed (assets-found takes over)', async () => {
      const u = coin(5_000);
      await ready([{ u, scan: assetsScan(u) }], oneAddressTestWallet());
      await userPick(u);
      expect(component.selectedRow()!.bucket).toBe('assets');
      expect(component.showSmallUtxoWarning()).toBe(false);
    });

    it('I5: single-address + >10k UTXO → suppressed (above threshold)', async () => {
      const u = coin(50_000);
      await ready([{ u, scan: { kind: 'not-scanned' } }], oneAddressTestWallet());
      await userPick(u);
      expect(component.selectedRow()!.bucket).toBe('unscanned');
      expect(component.showSmallUtxoWarning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // J. isSingleAddressWallet: payment address == ordinals address.
  // -------------------------------------------------------------------

  describe('J. isSingleAddressWallet', () => {
    it('J1: same addresses → true', async () => {
      wallets.connectedWalletSubject.next(oneAddressTestWallet());
      await settle();
      expect(component.isSingleAddressWallet()).toBe(true);
    });

    it('J2: different addresses → false', async () => {
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      expect(component.isSingleAddressWallet()).toBe(false);
    });

    it('J3: no wallet → false', async () => {
      wallets.connectedWalletSubject.next(null);
      await settle();
      expect(component.isSingleAddressWallet()).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // K. Mint command flow and "mint another".
  // -------------------------------------------------------------------

  describe('K. mint() / mintAnother()', () => {
    beforeEach(async () => {
      provider = installFakeCat21Provider();
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
    });

    it('K1: mint() calls orchestrator.mint and flips mintAttempted on first attempt', async () => {
      const mintSpy = jest.spyOn(orch, 'mint');
      provider!.rejectWith(new Error('cancelled'));
      await component.mint();
      await settle();
      expect(mintSpy).toHaveBeenCalledTimes(1);
      // the error is routed to mintError, not utxoError
      expect(component.mintError()).toBe('cancelled');
      expect(component.utxoError()).toBeNull();
    });

    it('K2: mint() error is swallowed and does not throw', async () => {
      provider!.rejectWith(new Error('user cancelled'));
      await expect(component.mint()).resolves.toBeUndefined();
    });

    it('K3: mintAnother() resets mintAttempted and calls orchestrator.reset', async () => {
      const resetSpy = jest.spyOn(orch, 'reset');
      provider!.rejectWith(new Error('boom'));
      await component.mint();
      await settle();
      expect(component.mintError()).toBe('boom');

      component.mintAnother();
      await settle();
      expect(resetSpy).toHaveBeenCalledTimes(1);

      // After reset, a fresh utxo-load error attributes to utxoError again
      const held = ports.holdUtxos();
      const reload = orch.refreshUtxos();
      held.fail(new Error('utxo fetch failed'));
      await reload;
      await settle();
      expect(component.utxoError()).toBe('Failed to load UTXOs: utxo fetch failed');
      expect(component.mintError()).toBeNull();
    });

    it('K4: mint() has the wallet sign the funding input and broadcasts the transaction', async () => {
      await component.mint();
      await settle();
      expect(provider!.requests.map((r) => r.signAtIndex)).toEqual([[0]]);
      expect(ports.broadcast).toHaveBeenCalledTimes(1);
      expect(component.state()).toBe('success');
      expect(component.successTxId()).toBe(await ports.broadcast.mock.results[0]!.value);
    });
  });

  // -------------------------------------------------------------------
  // L. selectUtxo: the expert override reaches the orchestrator.
  // -------------------------------------------------------------------

  describe('L. selectUtxo (expert override)', () => {
    it('L1: clicking a row delegates to orchestrator.setSelectedUtxo', async () => {
      const u = coin(60_000);
      await ready([{ u, scan: { kind: 'scanned-clean' } }]);
      const setSelected = jest.spyOn(orch, 'setSelectedUtxo');
      component.selectUtxo({ utxo: u, simulation: simulation(), scan: { kind: 'scanned-clean' }, bucket: 'clean' });
      expect(setSelected).toHaveBeenCalledWith(u);
    });

    it('L2: user can explicitly pick an assets-bearing row (override path)', async () => {
      const u = coin(5_000);
      await ready([{ u, scan: assetsScan(u) }], oneAddressTestWallet());
      // the SDK refuses the asset coin on its own → no spend coin
      expect(selected()).toBeNull();
      component.selectUtxo({ utxo: u, simulation: simulation(), scan: assetsScan(u), bucket: 'assets' });
      await settle();
      expect({ txid: selected()!.txid, vout: selected()!.vout, bucket: selected()!.bucket }).toEqual({ txid: u.txid, vout: u.vout, bucket: 'assets' });
      expect(component.selectedRow()!.bucket).toBe('assets');
    });
  });

  // -------------------------------------------------------------------
  // M. Small helpers.
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

    it('M4: exposes the shared inscription link, and a rune renders as plain text until its etching resolves', () => {
      const txid = 'a'.repeat(64);
      // Link construction itself is proven in funding-asset-links.spec; here we
      // pin that the panel delegates to it rather than building its own URL.
      expect(component.inscriptionReviewLink(`${txid}i0`)).toBe(`https://ordpool.space/tx/${txid}?artifact=${txid}i0`);
      // Nothing resolved yet → no link, so the row shows the balance as text.
      expect(component.runeEtchingHref('UNCOMMON•GOODS')).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // N. Success card shows the broadcast txid.
  // -------------------------------------------------------------------

  describe('N. success state', () => {
    it('N1: state=success shows the success marker with the broadcast txid', async () => {
      provider = installFakeCat21Provider();
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      await component.mint();
      await settle();
      const txid = component.successTxId();
      expect(txid).toMatch(/^[0-9a-f]{64}$/);
      const node = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mint-success"]');
      expect(node).toBeTruthy();
      expect(node!.textContent).toContain(txid!);
    });
  });

  // -------------------------------------------------------------------
  // MATRIX section — IDs come from `/Work/ordpool/PLAN-mint-test-matrix.md`
  // and stay stable across both spec files. The "B" suffix means "both
  // sites carry the same assertion"; grep MATRIX-A5 to find the paired
  // copy in ordpool's cat21-mint.component.spec.ts.
  // -------------------------------------------------------------------

  describe('MATRIX-A. wallet lifecycle', () => {
    it('MATRIX-A5(B): wallet swap resets scanner', async () => {
      // First connect → no reset (initial null → wallet)
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      scanner.reset.mockClear();
      // Swap → reset fires
      wallets.connectedWalletSubject.next(oneAddressTestWallet());
      await settle();
      expect(scanner.reset).toHaveBeenCalledTimes(1);
    });

    it('MATRIX-A6(B): initial null → wallet emission does NOT reset the scanner', async () => {
      scanner.reset.mockClear();
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      expect(scanner.reset).not.toHaveBeenCalled();
    });

    it('MATRIX-A9(B): disconnect returns to idle state', async () => {
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      wallets.connectedWalletSubject.next(null);
      await settle();
      expect(component.state()).toBe('idle');
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="mint-cta"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="ready"]')).toBeNull();
    });
  });

  describe('MATRIX-B. fee-rate-driven viability', () => {
    it('MATRIX-B14(B): recommendedFundingSats increases strictly across 1/5/50/100 sat/vB', async () => {
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      const values: number[] = [];
      for (const rate of [1, 5, 50, 100]) {
        component.onFeeRateChange(rate);
        await settle();
        values.push(component.recommendedFundingSats());
      }
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    });

    it('MATRIX-B15(B): feeRate=null yields the same funding as feeRate=1 (the `?? 1` fallback)', async () => {
      wallets.connectedWalletSubject.next(testWallet());
      await settle();
      component.onFeeRateChange(1);
      await settle();
      const atOne = component.recommendedFundingSats();
      component.mintAnother(); // orchestrator reset → fee rate null
      await settle();
      expect(component.feeRate()).toBeNull();
      expect(component.recommendedFundingSats()).toBe(atOne);
    });
  });

  describe('MATRIX-D. bucket-driven UI', () => {
    it('MATRIX-D15(B): viable row list is capped at 10 entries', async () => {
      await ready(Array.from({ length: 25 }, (_, i) => ({
        u: coin(50_000 + i),
        scan: { kind: 'scanned-clean' } as UtxoScanState,
      })));
      expect(component.allViableRows().length).toBe(25);
      expect(component.viableRows().length).toBe(10);
    });

    it('MATRIX-D16(B): viable rows sorted strictly descending by UTXO value', async () => {
      await ready([
        { u: coin(10_000), scan: { kind: 'scanned-clean' } },
        { u: coin(50_000), scan: { kind: 'scanned-clean' } },
        { u: coin(30_000), scan: { kind: 'scanned-clean' } },
      ]);
      expect(component.viableRows().map((r) => r.utxo.value)).toEqual([50_000, 30_000, 10_000]);
    });
  });

  describe('MATRIX-E. expert-panel visibility (THE 2026-06-12 regression group)', () => {
    // The assets-only cases run on a one-address wallet, where the SDK
    // blocks (expert-required) and leaves the selection to the user.
    const assetsOnly = async (u = coin(50_000)) => ready([{ u, scan: assetsScan(u) }], oneAddressTestWallet());

    it('MATRIX-E1(B): expert panel renders when viableRows > 0 AND a row is selected (baseline)', async () => {
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      expect(component.viableRows().length).toBeGreaterThan(0);
      expect(component.selectedRow()).not.toBeNull();
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E2(B): **THE REGRESSION** — expert panel must render when viableRows > 0 even if selectedRow is null (assets-only case)', async () => {
      await assetsOnly();
      expect(component.viableRows().length).toBeGreaterThan(0);
      expect(component.selectedRow()).toBeNull();
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E3(B): expert panel logic skips render when there are no viable rows', async () => {
      await ready([]);
      expect(component.viableRows().length).toBe(0);
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E4(C): pickerOpenByDefault is true when no row is auto-selected', async () => {
      await assetsOnly();
      expect(component.selectedRow()).toBeNull();
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E5(C): pickerOpenByDefault is true when selected bucket is "assets"', async () => {
      const u1 = coin(50_000);
      await assetsOnly(u1);
      await userPick(u1);
      expect(component.selectedRow()!.bucket).toBe('assets');
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E6(C): pickerOpenByDefault is true when selected bucket is "failed"', async () => {
      const u = coin(50_000);
      await ready([{ u, scan: { kind: 'scan-failed', message: 'oops' } }], oneAddressTestWallet());
      await userPick(u);
      expect(component.selectedRow()!.bucket).toBe('failed');
      expect(component.pickerOpenByDefault()).toBe(true);
    });

    it('MATRIX-E7(C): pickerOpenByDefault is false when selected bucket is "clean" (happy path)', async () => {
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      expect(component.selectedRow()!.bucket).toBe('clean');
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E8(C): pickerOpenByDefault is false when selected bucket is "unscanned" (probably-safe path)', async () => {
      const u = coin(80_000);
      await ready([{ u, scan: { kind: 'not-scanned' } }]);
      await userPick(u);
      expect(component.selectedRow()!.bucket).toBe('unscanned');
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E9(B): panel state survives a fee-rate change that keeps viable rows > 0', async () => {
      await ready([{ u: coin(50_000), scan: { kind: 'scanned-clean' } }]);
      const beforeRows = component.viableRows().length;
      component.onFeeRateChange(10);
      await settle();
      expect(component.viableRows().length).toBe(beforeRows);
      expect(component.pickerOpenByDefault()).toBe(false);
    });

    it('MATRIX-E10(B): summary panel is hidden when no row is selected', async () => {
      await assetsOnly();
      expect(component.selectedRow()).toBeNull();
      // The production template gates the summary and the mint button on canMint.
      expect(component.canMint()).toBe(false);
    });

    it('MATRIX-E11(B): mint button disabled when there is no row selection', async () => {
      await assetsOnly();
      expect(selected()).toBeNull();
      expect(component.canMint()).toBe(false);
    });

    it('MATRIX-E12(B): mint button re-enables after the user explicitly picks an assets row ("Use anyway")', async () => {
      const u1 = coin(50_000);
      await assetsOnly(u1);
      expect(component.canMint()).toBe(false);
      component.selectUtxo({ utxo: u1, simulation: simulation(), scan: assetsScan(u1), bucket: 'assets' });
      await settle();
      expect(component.canMint()).toBe(true);
    });
  });

  describe('MATRIX-I. edge cases', () => {
    it('MATRIX-I20(B): runeNames returns [] for null runes (no crash)', () => {
      const empty = component.runeNames({ outpoint: 'x:0', inscriptionIds: [], runes: null, catIds: [], catSat: null, rareSat: null });
      expect(empty).toEqual([]);
    });

    // MATRIX-I21(B) (bucketTooltip) lives in utxo-picker.spec.ts: the tooltip
    // helper is on the shared UtxoPicker, which the mint renders.
  });
});
