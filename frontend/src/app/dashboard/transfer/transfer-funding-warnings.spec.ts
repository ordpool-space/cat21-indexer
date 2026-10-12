/**
 * @test-kind unit
 * Real:   Transfer component with its real template and children (FeesPicker, UtxoPicker, FundingAssetList,
 *         WalletConnect); the SDK Cat21TransferOrchestrator on the production port wiring (cat21OrchestratorPorts,
 *         'derive'), the SDK Cat21Service and UtxoContentScanner, recommendFunding; CatUtxoLookupService, OrdApiService
 * Faked:  fetch (testing/funding-fetch.fixtures): electrs' UTXO list (TxnOutput, test-wallet coins), the fee tiers
 *         (recommendedFeesFixture, ordpool-sdk) and ord + cat21-ord /output (inscribedOutputFixture,
 *         notIndexedOutputFixture, ordpool-sdk)
 *         unnamed-assets only: the orchestrator's scan port answers 'has-assets' with no detail, or with a detail
 *         whose fields are all empty (ContentScanPort shape), the answers a port that cannot name assets gives
 *         HttpClient -> HttpTestingController: cat21-ord /address for the holdings list answers no cats (the
 *         OrdAddressResponse shape ord-api.service.spec pins)
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         The cat to send is set on the real orchestrator (setCatUtxo), as the page does after a pick
 * Proves: each expert-required cause renders its own warning (named assets listed and linked, unnamed assets,
 *         unknown content), the transfer CTA stays disabled and no coin carries the recommended star; a
 *         separate-address wallet whose only cover is unnamed or unchecked gets that warning and a disabled CTA,
 *         never an empty notice beside an enabled CTA; the asset notice names the coin, keeps the CTA enabled
 *         and the star
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  Cat21Service,
  Cat21TransferOrchestrator,
  ContentScanPort,
  Network,
  TxnOutput,
  UtxoContentScanner,
  WalletInfo,
  WalletService,
  inscribedOutputFixture,
  notIndexedOutputFixture,
  outpointKey,
} from 'ordpool-sdk';

import { environment } from '../../../environments/environment';
import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { cat21OrchestratorPorts } from '../../shared/cat21-orchestrator-ports';
import { Transfer } from './transfer';
import { FUNDING_TEST_CONFIG, FundingFetch, installFundingFetch } from '../../testing/funding-fetch.fixtures';
import { WalletServiceStub } from '../../testing/wallet.fixtures';
import {
  TEST_ORDINALS_ADDRESS,
  TEST_PAYMENT_ADDRESS,
  fundingCoin,
  oneAddressTestWallet,
  testWallet,
} from '../../testing/test-wallet.fixtures';

const INSCRIPTION_ID = `${'e'.repeat(64)}i0`;
/** The cat being sent: an outpoint the funding list does not contain. */
const CAT = { catNumber: 7, txid: 'c7'.repeat(32), vout: 0, value: 546 };

/** Collapse template whitespace so a sentence compares as one line. */
const text = (el: Element | null): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

type ScanWiring = 'scanner' | 'bare-has-assets' | 'empty-detail';

let io: FundingFetch | null = null;

afterEach(() => {
  io?.restore();
  io = null;
});

async function mount(opts: { coins: TxnOutput[]; scan?: ScanWiring }) {
  io = installFundingFetch();
  io.setUtxos(TEST_PAYMENT_ADDRESS, opts.coins);
  const cat21 = new Cat21Service(FUNDING_TEST_CONFIG, Network.Mainnet);
  const scanner = new UtxoContentScanner(FUNDING_TEST_CONFIG);
  const ports: Record<ScanWiring, ContentScanPort> = {
    scanner,
    'bare-has-assets': { classify: async () => 'has-assets' },
    'empty-detail': {
      classify: async () => ({ verdict: 'has-assets', assets: { inscriptionIds: [], runeNames: [], catIds: [], rareSat: null } }),
    },
  };
  const orch = new Cat21TransferOrchestrator({
    ...cat21OrchestratorPorts(cat21, FUNDING_TEST_CONFIG, Network.Mainnet, 'derive'),
    scan: ports[opts.scan ?? 'scanner'],
  });
  const wallets = new WalletServiceStub();

  await TestBed.configureTestingModule({
    imports: [Transfer],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: cat21Config, useValue: FUNDING_TEST_CONFIG },
      { provide: bitcoinNetwork, useValue: Network.Mainnet },
      { provide: Cat21Service, useValue: cat21 },
      { provide: UtxoContentScanner, useValue: scanner },
      { provide: WalletService, useValue: wallets },
      { provide: Cat21TransferOrchestrator, useValue: orch },
    ],
  }).compileComponents();

  const fixture: ComponentFixture<Transfer> = TestBed.createComponent(Transfer);
  const component = fixture.componentInstance;
  const el: HTMLElement = fixture.nativeElement;
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();

  async function until(done: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      fixture.detectChanges();
      if (done()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`never reached: ${what} (status ${component.fundingRecommendation().status})`);
  }

  /** Connect `w`, answer its holdings, pick the cat and a recipient, and wait for the SDK's verdict. */
  async function connect(w: WalletInfo, status: string): Promise<void> {
    wallets.connectedWalletSubject.next(w);
    fixture.detectChanges();
    http
      .expectOne(`${environment.ordExplorer}/address/${w.ordinalsAddress}`)
      .flush({ outputs: [], cats: [], cat_numbers: [], sat_balance: 0 });
    orch.setCatUtxo(CAT);
    component.onRecipientChange(TEST_ORDINALS_ADDRESS);
    await until(() => component.fundingRecommendation().status === status, `funding status ${status}`);
  }

  const q = (testid: string) => el.querySelector(`[data-testid="${testid}"]`);
  const cta = () => el.querySelector('button[data-testid="transfer-cta"]') as HTMLButtonElement;
  const star = () => el.querySelector('[data-testid="utxo-recommended"]');

  return { fixture, component, el, until, connect, q, cta, star };
}

describe('Transfer: the expert-required warning names its cause', () => {

  it('named-assets (one-address wallet, inscribed coin): the warning lists the inscription, linked', async () => {
    const coin = fundingCoin(30_000, 0x71);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(oneAddressTestWallet(), 'expert-required');

    expect(t.q('transfer-funding-expert-required')?.getAttribute('data-cause')).toBe('named-assets');
    expect(text(t.q('transfer-funding-expert-required-text'))).toBe(
      '⚠ None of your content-clean coins can cover the miner fee. Your wallet keeps assets and payments on one ' +
        'address, and the coin that would cover the fee carries the assets below. Expand Funding source below and ' +
        'pick a coin deliberately (its asset goes to the miner as fee), or add a plain payment UTXO to your wallet.',
    );
    const link = t.q('transfer-funding-expert-required-inscription') as HTMLAnchorElement;
    expect(text(link)).toBe(INSCRIPTION_ID);
    expect(link.getAttribute('href')).toBe(`https://ordpool.space/tx/${'e'.repeat(64)}?artifact=${INSCRIPTION_ID}`);
    expect(t.q('transfer-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('named-assets: the transfer CTA is disabled', async () => {
    const coin = fundingCoin(30_000, 0x72);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(oneAddressTestWallet(), 'expert-required');
    expect(t.cta().disabled).toBe(true);
  });

  it('named-assets: the picker lists the coin and marks none as recommended', async () => {
    const coin = fundingCoin(30_000, 0x73);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(oneAddressTestWallet(), 'expert-required');
    expect(t.q(`utxo-row-${coin.txid}-${coin.vout}`)).not.toBeNull();
    expect(t.star()).toBeNull();
  });

  it.each<[string, ScanWiring]>([
    ['a bare has-assets verdict', 'bare-has-assets'],
    ['a detail that names nothing', 'empty-detail'],
  ])('unnamed-assets on a separate-address wallet (%s): its own warning, never a notice', async (_label, scan) => {
    const coin = fundingCoin(30_000, 0x74);
    const t = await mount({ coins: [coin], scan });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'expert-required');

    expect(t.q('transfer-funding-expert-required')?.getAttribute('data-cause')).toBe('unnamed-assets');
    expect(text(t.q('transfer-funding-expert-required-text'))).toBe(
      "⚠ None of your content-clean coins can cover the miner fee. The coins that can carry assets the scan could " +
        "not name, so we can't tell you what the transfer would give away. Expand Funding source below and pick a " +
        'coin only if you know what it holds (its asset goes to the miner as fee), or add a plain payment UTXO to ' +
        'your wallet.',
    );
    expect(t.q('transfer-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it.each<[string, ScanWiring]>([
    ['a bare has-assets verdict', 'bare-has-assets'],
    ['a detail that names nothing', 'empty-detail'],
  ])('unnamed-assets (%s): the transfer CTA is disabled and no coin carries the star', async (_label, scan) => {
    const coin = fundingCoin(30_000, 0x75);
    const t = await mount({ coins: [coin], scan });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'expert-required');
    expect(t.cta().disabled).toBe(true);
    expect(t.star()).toBeNull();
  });

  it('unknown-content (separate-address wallet, only a coin ord has not indexed): its own warning', async () => {
    const coin = fundingCoin(30_000, 0x76);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await t.connect(testWallet(), 'expert-required');

    expect(t.q('transfer-funding-expert-required')?.getAttribute('data-cause')).toBe('unknown-content');
    expect(text(t.q('transfer-funding-expert-required-text'))).toBe(
      "⚠ None of your content-clean coins can cover the miner fee, and we couldn't check the coins that can for " +
        'ordinal-bound assets. Expand Funding source below and pick a coin deliberately, or add a plain payment ' +
        'UTXO to your wallet.',
    );
    expect(t.q('transfer-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('unknown-content: the transfer CTA is disabled and no coin carries the star', async () => {
    const coin = fundingCoin(30_000, 0x77);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await t.connect(testWallet(), 'expert-required');
    expect(t.cta().disabled).toBe(true);
    expect(t.star()).toBeNull();
  });
});

describe('Transfer: the asset notice (separate-address wallet, named assets) stays a notice', () => {

  it('names the inscription on the coin', async () => {
    const coin = fundingCoin(30_000, 0x78);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'asset-notice');
    expect(text(t.q('transfer-asset-notice-inscription'))).toBe(INSCRIPTION_ID);
    expect(t.q('transfer-funding-expert-required')).toBeNull();
  });

  it('keeps the transfer CTA enabled and marks the coin as recommended', async () => {
    const coin = fundingCoin(30_000, 0x79);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'asset-notice');
    await t.until(() => !t.cta().disabled, 'CTA enabled');
    const row = t.q(`utxo-row-${coin.txid}-${coin.vout}`);
    expect(row?.querySelector('[data-testid="utxo-recommended"]')).not.toBeNull();
  });
});
