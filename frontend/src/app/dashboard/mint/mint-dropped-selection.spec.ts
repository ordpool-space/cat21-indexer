/**
 * @test-kind unit
 * Real:   Mint component with its real template and children (FeesPicker, UtxoPicker, DroppedSelectionNotice,
 *         FundingAssetList, SingleAddressNote, WalletConnect); the SDK Cat21MintOrchestrator on the production
 *         port wiring (cat21OrchestratorPorts, 'derive'), the SDK Cat21Service and UtxoContentScanner,
 *         recommendFunding and describeFundingPick
 * Faked:  fetch (testing/funding-fetch.fixtures): electrs' UTXO list (fundingCoin rows built on
 *         electrsConfirmedUtxoFixture, ordpool-sdk/testing), the fee tiers (recommendedFeesFixture, ordpool-sdk)
 *         and ord + cat21-ord /output (cleanOutputFixture, inscribedOutputFixture, ordpool-sdk)
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         HttpClient -> HttpTestingController (PriceService and the wallet-connect services; nothing answered)
 * Proves: a picked coin that no longer covers at a raised fee rate, or that leaves the wallet, is named in a
 *         notice with its reason and remedy, the summary and the picker's ✓ show the coin the SDK spends
 *         instead, and the CTA follows the SDK's verdict on that coin (enabled on a clean replacement, disabled
 *         when nothing replaces it, and while a recompute is in flight); a new pick clears the notice; with no pick a
 *         rate change shows none
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  Cat21MintOrchestrator,
  Cat21Service,
  Network,
  TxnOutput,
  UtxoContentScanner,
  WalletInfo,
  WalletService,
  cleanOutputFixture,
  inscribedOutputFixture,
  outpointKey,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { cat21OrchestratorPorts } from '../../shared/cat21-orchestrator-ports';
import { Mint } from './mint';
import { FUNDING_TEST_CONFIG, FundingFetch, installFundingFetch } from '../../testing/funding-fetch.fixtures';
import { WalletServiceStub } from '../../testing/wallet.fixtures';
import { TEST_PAYMENT_ADDRESS, fundingCoin, oneAddressTestWallet, testWallet } from '../../testing/test-wallet.fixtures';

const INSCRIPTION_ID = `${'e'.repeat(64)}i0`;
/** Covers the mint at the seeded 2 sat/vB, not at 50. */
const SMALL = fundingCoin(2_000, 0x91);
/** Covers the mint at every rate these cases set. */
const LARGE = fundingCoin(200_000, 0x92);

/** Collapse template whitespace so a sentence compares as one line. */
const text = (el: Element | null): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

let io: FundingFetch | null = null;

afterEach(() => {
  io?.restore();
  io = null;
});

async function mount(coins: TxnOutput[]) {
  io = installFundingFetch();
  io.setUtxos(TEST_PAYMENT_ADDRESS, coins);
  for (const c of coins) io.setOutput(outpointKey(c), cleanOutputFixture());
  const cat21 = new Cat21Service(FUNDING_TEST_CONFIG, Network.Mainnet);
  const scanner = new UtxoContentScanner(FUNDING_TEST_CONFIG);
  // The orchestrator's scan port is the page's scanner behind a gate a case can
  // close, to hold a recompute in flight.
  const gate = { held: Promise.resolve(), open: () => undefined as void };
  const holdScans = () => {
    let open!: () => void;
    gate.held = new Promise<void>((r) => { open = r; });
    gate.open = open;
  };
  const orch = new Cat21MintOrchestrator({
    ...cat21OrchestratorPorts(cat21, FUNDING_TEST_CONFIG, Network.Mainnet, 'derive'),
    scan: { classify: async (outpoint: string) => { await gate.held; return scanner.classify(outpoint); } },
  });
  const wallets = new WalletServiceStub();

  await TestBed.configureTestingModule({
    imports: [Mint],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: cat21Config, useValue: FUNDING_TEST_CONFIG },
      { provide: bitcoinNetwork, useValue: Network.Mainnet },
      { provide: Cat21Service, useValue: cat21 },
      { provide: UtxoContentScanner, useValue: scanner },
      { provide: WalletService, useValue: wallets },
      { provide: Cat21MintOrchestrator, useValue: orch },
    ],
  }).compileComponents();

  const fixture: ComponentFixture<Mint> = TestBed.createComponent(Mint);
  const component = fixture.componentInstance;
  const el: HTMLElement = fixture.nativeElement;
  fixture.detectChanges();

  async function until(done: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      fixture.detectChanges();
      if (done()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`never reached: ${what} (resolved status ${component.resolvedFundingStatus()})`);
  }

  const q = (testid: string) => el.querySelector(`[data-testid="${testid}"]`);
  const cta = () => q('mint-btn') as HTMLButtonElement;
  const spends = (c: TxnOutput) => component.resolvedFundingUtxo()?.txid === c.txid && component.resolvedFundingStatus() === 'ready';
  /** The outpoint the summary's Source row shows. */
  const summarySource = () => text(el.querySelector('[data-testid="mint-summary-section"] .mint-summary-row code'));
  /** The txid of the picker row marked ✓. */
  const checkedRow = () => el.querySelector('.utxo-row-selected')?.getAttribute('data-testid') ?? null;

  /** Connect `w` and wait for the SDK to settle on a coin at the seeded rate. */
  async function connect(w: WalletInfo, first: TxnOutput): Promise<void> {
    wallets.connectedWalletSubject.next(w);
    await until(() => spends(first), `spends ${first.value}`);
  }

  /** Click the picker's Pick button on `c`, as the person does. */
  async function pick(c: TxnOutput): Promise<void> {
    (el.querySelector(`button[data-testid="utxo-pick-${c.txid}"]`) as HTMLButtonElement).click();
    await until(() => component.selectedUtxo()?.txid === c.txid && component.resolvedFundingStatus() !== 'scanning', `picked ${c.value}`);
  }

  /** Type a fee rate into the picker's manual field. */
  function enterRate(rate: number): void {
    const input = q('fees-picker-manual-input') as HTMLInputElement;
    input.value = String(rate);
    input.dispatchEvent(new Event('input'));
  }

  /** Type a fee rate and wait for the SDK's verdict at it. */
  async function typeRate(rate: number): Promise<void> {
    enterRate(rate);
    await until(() => component.feeRate() === rate && component.resolvedFundingStatus() !== 'scanning', `rate ${rate}`);
  }

  return { fixture, component, el, orch, until, connect, pick, enterRate, typeRate, holdScans, gate, q, cta, spends, summarySource, checkedRow };
}

describe('Mint: a replaced pick is named (droppedSelection)', () => {

  it('below-requirement: the picked coin no longer covers at 50 sat/vB; the notice names it, the mint spends the other coin', async () => {
    const m = await mount([SMALL, LARGE]);
    await m.connect(testWallet(), SMALL);
    await m.pick(SMALL);
    expect(m.q('mint-dropped-selection')).toBeNull();

    await m.typeRate(50);
    await m.until(() => m.spends(LARGE), 'spends the large coin');

    const notice = m.q('mint-dropped-selection');
    expect(notice?.getAttribute('data-reason')).toBe('below-requirement');
    expect(text(notice)).toBe(
      `The coin you picked, ${SMALL.txid}:0, no longer covers this transaction at 50 sat/vB. ` +
        'Lower the fee rate, or pick another coin below.',
    );
    expect(m.summarySource()).toBe(`${LARGE.txid}:0`);
    expect(m.checkedRow()).toBe(`utxo-row-${LARGE.txid}-0`);
    expect(m.cta().disabled).toBe(false);
    expect((m.q('mint-expert') as HTMLDetailsElement).open).toBe(true);
    expect(io!.unexpected).toEqual([]);
  });

  it('gone: the picked coin leaves the wallet; the notice names it, the mint spends the other coin', async () => {
    const m = await mount([SMALL, LARGE]);
    await m.connect(testWallet(), SMALL);
    await m.pick(LARGE);

    io!.setUtxos(TEST_PAYMENT_ADDRESS, [SMALL]);
    await m.orch.refreshUtxos();
    await m.until(() => m.spends(SMALL), 'spends the small coin');

    const notice = m.q('mint-dropped-selection');
    expect(notice?.getAttribute('data-reason')).toBe('gone');
    expect(text(notice)).toBe(`The coin you picked, ${LARGE.txid}:0, is no longer available. Pick another coin below.`);
    expect(m.summarySource()).toBe(`${SMALL.txid}:0`);
    expect(m.checkedRow()).toBe(`utxo-row-${SMALL.txid}-0`);
    expect(m.cta().disabled).toBe(false);
  });

  it('gone with nothing to replace it: the notice stays, no coin is spent and the CTA is disabled', async () => {
    // One-address wallet: the remaining coin carries an inscription, which the
    // SDK will not spend on its own, so the drop resolves to no coin at all.
    const dirty = fundingCoin(150_000, 0x93);
    const m = await mount([LARGE, dirty]);
    io!.setOutput(outpointKey(dirty), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(oneAddressTestWallet(), LARGE);
    await m.pick(LARGE);

    io!.setUtxos(TEST_PAYMENT_ADDRESS, [dirty]);
    await m.orch.refreshUtxos();
    await m.until(() => m.component.resolvedFundingStatus() === 'expert-required', 'expert-required');

    expect(m.q('mint-dropped-selection')?.getAttribute('data-reason')).toBe('gone');
    expect(m.component.resolvedFundingUtxo()).toBeNull();
    expect(m.q('mint-summary-section')).toBeNull();
    expect(m.cta().disabled).toBe(true);
  });

  it('a new pick clears the notice', async () => {
    const m = await mount([SMALL, LARGE]);
    await m.connect(testWallet(), SMALL);
    await m.pick(SMALL);
    await m.typeRate(50);
    await m.until(() => m.q('mint-dropped-selection') !== null, 'notice shown');

    await m.pick(LARGE);

    expect(m.q('mint-dropped-selection')).toBeNull();
    expect(m.summarySource()).toBe(`${LARGE.txid}:0`);
  });

  it('with no pick, a rate change that moves the SDK to another coin shows no notice', async () => {
    const m = await mount([SMALL, LARGE]);
    await m.connect(testWallet(), SMALL);

    await m.typeRate(50);
    await m.until(() => m.spends(LARGE), 'spends the large coin');

    expect(m.component.droppedSelection()).toBeNull();
    expect(m.q('mint-dropped-selection')).toBeNull();
    expect(m.summarySource()).toBe(`${LARGE.txid}:0`);
  });

  it('while the SDK re-prices after a rate change, the CTA waits for its verdict', async () => {
    const m = await mount([SMALL, LARGE]);
    await m.connect(testWallet(), SMALL);
    expect(m.cta().disabled).toBe(false);

    m.holdScans();
    m.enterRate(3);
    await m.until(() => m.component.resolvedFundingStatus() === 'scanning', 'recompute in flight');
    expect(m.cta().disabled).toBe(true);

    m.gate.open();
    await m.until(() => m.spends(SMALL), 'verdict at 3 sat/vB');
    expect(m.cta().disabled).toBe(false);
  });
});
