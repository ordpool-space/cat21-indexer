/**
 * @test-kind unit
 * Real:   Mint component with its real template and children (FeesPicker, UtxoPicker, FundingAssetList,
 *         SingleAddressNote, WalletConnect); the SDK Cat21MintOrchestrator on the production port wiring
 *         (cat21OrchestratorPorts, 'derive'), the SDK Cat21Service and UtxoContentScanner, recommendFunding
 * Faked:  fetch (testing/funding-fetch.fixtures): electrs' UTXO list (fundingCoin rows built on electrsConfirmedUtxoFixture, ordpool-sdk/testing), the fee tiers
 *         (recommendedFeesFixture, ordpool-sdk) and ord + cat21-ord /output (inscribedOutputFixture,
 *         notIndexedOutputFixture, cleanOutputFixture, ordpool-sdk)
 *         unnamed-assets only: the orchestrator's scan port answers a bare 'has-assets' (ContentScanPort shape),
 *         the answer a cat-only port gives
 *         the broadcast (POST /api/tx, answered with the txid as esplora does)
 *         window.Cat21Provider (the wallet API) -> installFakeCat21Provider, signing with the test wallet's keys
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         HttpClient -> HttpTestingController (PriceService and the wallet-connect services; nothing answered)
 * Proves: each expert-required cause renders its own warning (named assets listed and linked, unnamed assets,
 *         unknown content with a working Retry scan), the mint CTA stays disabled, and no coin carries the
 *         recommended star; a separate-address wallet whose only cover is unnamed or unchecked gets that warning
 *         and a disabled CTA, never a notice; the asset notice names the coin and keeps the CTA enabled with the star;
 *         a mint that reaches the orchestrator on expert-required is refused with a FundingBlockedError whose cause
 *         and coin are the ones the warning shows, and signs nothing; on the notice the CTA mints with that coin
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import {
  Cat21MintOrchestrator,
  Cat21Service,
  ContentScanPort,
  Network,
  TxnOutput,
  UtxoContentScanner,
  WalletInfo,
  WalletService,
  cleanOutputFixture,
  inscribedOutputFixture,
  isFundingBlockedError,
  notIndexedOutputFixture,
  outpointKey,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { cat21OrchestratorPorts } from '../../shared/cat21-orchestrator-ports';
import { Mint } from './mint';
import { FUNDING_TEST_CONFIG, FundingFetch, installFundingFetch } from '../../testing/funding-fetch.fixtures';
import { WalletServiceStub } from '../../testing/wallet.fixtures';
import {
  TEST_PAYMENT_ADDRESS,
  fundingCoin,
  installFakeCat21Provider,
  oneAddressTestWallet,
  testWallet,
} from '../../testing/test-wallet.fixtures';

const INSCRIPTION_ID = `${'e'.repeat(64)}i0`;

/** Collapse template whitespace so a sentence compares as one line. */
const text = (el: Element | null): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

let io: FundingFetch | null = null;
let provider: ReturnType<typeof installFakeCat21Provider> | null = null;

afterEach(() => {
  io?.restore();
  io = null;
  provider?.restore();
  provider = null;
});

/**
 * Mount the mint page. `scan: 'scanner'` wires the orchestrator's scan port to
 * the page's own UtxoContentScanner (one instance, so badges and verdict agree);
 * `scan: 'bare-has-assets'` wires a port that answers `'has-assets'` and names
 * nothing.
 */
async function mount(opts: { coins: TxnOutput[]; scan?: 'scanner' | 'bare-has-assets' }) {
  io = installFundingFetch();
  io.setUtxos(TEST_PAYMENT_ADDRESS, opts.coins);
  const cat21 = new Cat21Service(FUNDING_TEST_CONFIG, Network.Mainnet);
  const scanner = new UtxoContentScanner(FUNDING_TEST_CONFIG);
  const bareHasAssets: ContentScanPort = { classify: async () => 'has-assets' };
  const orch = new Cat21MintOrchestrator({
    ...cat21OrchestratorPorts(cat21, FUNDING_TEST_CONFIG, Network.Mainnet, 'derive'),
    scan: opts.scan === 'bare-has-assets' ? bareHasAssets : scanner,
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
  const el: HTMLElement = fixture.nativeElement;
  fixture.detectChanges();

  /** Flush effects, fetches and change detection until `done()` holds; fails loudly instead of hanging. */
  async function until(done: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      fixture.detectChanges();
      if (done()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`never reached: ${what} (status ${fixture.componentInstance.debugFunding().status})`);
  }

  /** Connect `w` and wait for the SDK's verdict at the seeded fee rate. */
  async function connect(w: WalletInfo, status: string): Promise<void> {
    wallets.connectedWalletSubject.next(w);
    await until(() => fixture.componentInstance.debugFunding().status === status, `funding status ${status}`);
  }

  const q = (testid: string) => el.querySelector(`[data-testid="${testid}"]`);
  const cta = () => q('mint-btn') as HTMLButtonElement;
  const star = () => el.querySelector('[data-testid="utxo-recommended"]');

  return { fixture, el, orch, until, connect, q, cta, star };
}

describe('Mint: the expert-required warning names its cause', () => {

  it('named-assets (one-address wallet, inscribed coin): the warning lists the inscription, linked', async () => {
    const coin = fundingCoin(30_000, 0x61);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(oneAddressTestWallet(), 'expert-required');

    const warning = m.q('mint-funding-expert-required');
    expect(warning?.getAttribute('data-cause')).toBe('named-assets');
    expect(text(m.q('mint-funding-expert-required-text'))).toBe(
      '⚠ None of your content-clean coins can cover the mint. Your wallet keeps assets and payments on one ' +
        'address, and the coin that would cover the mint carries the assets below. Pick a coin below to spend it ' +
        'deliberately (its asset goes to the miner as fee), or add a plain payment UTXO to your wallet.',
    );
    const link = m.q('mint-funding-expert-required-inscription') as HTMLAnchorElement;
    expect(text(link)).toBe(INSCRIPTION_ID);
    expect(text(link.closest('p'))).toBe(`Inscription: ${INSCRIPTION_ID}`);
    expect(link.getAttribute('href')).toBe(`https://ordpool.space/tx/${'e'.repeat(64)}?artifact=${INSCRIPTION_ID}`);
    expect(m.q('mint-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('named-assets: the mint CTA is disabled', async () => {
    const coin = fundingCoin(30_000, 0x62);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(oneAddressTestWallet(), 'expert-required');
    expect(m.cta().disabled).toBe(true);
  });

  it('named-assets: the picker lists the coin and marks none as recommended', async () => {
    const coin = fundingCoin(30_000, 0x63);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(oneAddressTestWallet(), 'expert-required');
    expect(m.q(`utxo-row-${coin.txid}-${coin.vout}`)).not.toBeNull();
    expect(m.star()).toBeNull();
  });

  it('unnamed-assets (separate-address wallet, bare has-assets verdict): its own warning, never a notice', async () => {
    const coin = fundingCoin(30_000, 0x64);
    const m = await mount({ coins: [coin], scan: 'bare-has-assets' });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(testWallet(), 'expert-required');

    expect(m.q('mint-funding-expert-required')?.getAttribute('data-cause')).toBe('unnamed-assets');
    expect(text(m.q('mint-funding-expert-required-text'))).toBe(
      "⚠ None of your content-clean coins can cover the mint. The coins that can carry assets the scan could not " +
        "name, so we can't tell you what minting would give away. Pick a coin below only if you know what it holds " +
        '(its asset goes to the miner as fee), or add a plain payment UTXO to your wallet.',
    );
    expect(m.q('mint-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('unnamed-assets: the mint CTA is disabled and no coin carries the star', async () => {
    const coin = fundingCoin(30_000, 0x65);
    const m = await mount({ coins: [coin], scan: 'bare-has-assets' });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(testWallet(), 'expert-required');
    expect(m.cta().disabled).toBe(true);
    expect(m.star()).toBeNull();
  });

  it('unknown-content (separate-address wallet, only a coin ord has not indexed): the "Couldn\'t check" warning', async () => {
    const coin = fundingCoin(30_000, 0x66);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await m.connect(testWallet(), 'expert-required');

    expect(m.q('mint-funding-expert-required')?.getAttribute('data-cause')).toBe('unknown-content');
    expect(text(m.q('mint-funding-expert-required-text'))).toBe(
      "⚠ None of your content-clean coins can cover the mint. Couldn't check these funds for ordinal-bound assets.",
    );
    expect(text(m.q('mint-funding-retry-scan'))).toBe('Retry scan');
    expect(text(m.q('mint-funding-expert-required'))).toBe(
      "⚠ None of your content-clean coins can cover the mint. Couldn't check these funds for ordinal-bound assets. " +
        'Retry scan Or pick a coin below to spend it deliberately, or add a plain payment UTXO to your wallet.',
    );
    expect(m.q('mint-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('unknown-content: the mint CTA is disabled and no coin carries the star', async () => {
    const coin = fundingCoin(30_000, 0x67);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await m.connect(testWallet(), 'expert-required');
    expect(m.cta().disabled).toBe(true);
    expect(m.star()).toBeNull();
  });

  it('unknown-content: Retry scan asks ord again and, once ord answers clean, the coin is auto-picked', async () => {
    const coin = fundingCoin(30_000, 0x68);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await m.connect(testWallet(), 'expert-required');
    const ordAsks = () => io!.calls.filter((u) => u === `${FUNDING_TEST_CONFIG.ordApiUrl}/output/${outpointKey(coin)}`).length;
    const before = ordAsks();

    io!.setOutput(outpointKey(coin), cleanOutputFixture());
    (m.q('mint-funding-retry-scan') as HTMLButtonElement).click();
    await m.until(() => m.fixture.componentInstance.debugFunding().status === 'auto', 'auto after retry');
    await m.until(() => !m.cta().disabled, 'CTA enabled after retry');

    expect(ordAsks()).toBeGreaterThan(before);
    expect(m.q('mint-funding-expert-required')).toBeNull();
    expect(m.star()).not.toBeNull();
  });
});

describe('Mint: the asset notice (separate-address wallet, named assets) stays a notice', () => {

  it('names the inscription on the coin', async () => {
    const coin = fundingCoin(30_000, 0x69);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => m.q('mint-asset-notice') !== null, 'notice rendered');
    expect(text(m.q('mint-asset-notice-inscription'))).toBe(INSCRIPTION_ID);
    expect(m.q('mint-funding-expert-required')).toBeNull();
  });

  it('keeps the mint CTA enabled and marks the coin as recommended', async () => {
    const coin = fundingCoin(30_000, 0x6a);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => !m.cta().disabled, 'CTA enabled');
    const row = m.q(`utxo-row-${coin.txid}-${coin.vout}`);
    expect(row?.querySelector('[data-testid="utxo-recommended"]')).not.toBeNull();
  });
});

describe('Mint: a blocked mint renders the facts the FundingBlockedError carries', () => {

  it('named-assets: a mint that reaches the orchestrator is refused with the cause and coin the warning shows; nothing is signed', async () => {
    const coin = fundingCoin(30_000, 0x6b);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    provider = installFakeCat21Provider();
    await m.connect(oneAddressTestWallet(), 'expert-required');
    const mintSpy = jest.spyOn(m.orch, 'mint');

    // The disabled CTA keeps a person out; a stale click reaches mint() directly.
    await expect(m.fixture.componentInstance.mint()).resolves.toBeUndefined();
    m.fixture.detectChanges();

    const err: unknown = await (mintSpy.mock.results[0]!.value as Promise<unknown>).catch((e: unknown) => e);
    expect(isFundingBlockedError(err)).toBe(true);
    if (!isFundingBlockedError(err)) return;
    expect(err.cause).toBe('named-assets');
    expect(m.q('mint-funding-expert-required')?.getAttribute('data-cause')).toBe(err.cause);
    expect(err.recommendation.recommended).toEqual({
      txid: coin.txid,
      vout: coin.vout,
      value: 30_000,
      bucket: 'assets',
      assets: { inscriptionIds: [INSCRIPTION_ID], runeNames: [], catIds: [], rareSat: null },
    });
    expect(text(m.q('mint-funding-expert-required-inscription'))).toBe(err.recommendation.recommended.assets?.inscriptionIds[0]);
    expect(m.cta().disabled).toBe(true);
    expect(provider.requests).toEqual([]);
    expect(io!.broadcasts).toEqual([]);
  });
});

describe('Mint: the asset notice proceeds to a mint with the noticed coin', () => {

  it('a separate-address wallet whose only cover carries a named inscription mints after the notice, spending that coin', async () => {
    const coin = fundingCoin(30_000, 0x6c);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    provider = installFakeCat21Provider();
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => m.q('mint-asset-notice') !== null && !m.cta().disabled, 'notice beside an enabled CTA');
    expect(text(m.q('mint-asset-notice-inscription'))).toBe(INSCRIPTION_ID);

    m.cta().click();
    await m.until(() => m.q('mint-success') !== null, 'mint success');

    expect(provider.requests.map((r) => r.signAtIndex)).toEqual([[0]]);
    expect(io!.broadcasts).toHaveLength(1);
    const tx = btc.Transaction.fromRaw(hex.decode(io!.broadcasts[0]!), { allowUnknownOutputs: true });
    expect(tx.inputsLength).toBe(1);
    expect(hex.encode(tx.getInput(0).txid!)).toBe(coin.txid);
    expect(tx.getInput(0).index).toBe(coin.vout);
    expect(tx.lockTime).toBe(21);
    expect(io!.unexpected).toEqual([]);
  });
});
