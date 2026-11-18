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
  catOutputFixture,
  cleanOutputFixture,
  inscribedOutputFixture,
  isFundingBlockedError,
  notIndexedOutputFixture,
  outpointKey,
} from 'ordpool-sdk';

import { cat21OrdCatInscriptionFixture } from 'ordpool-sdk/testing';

import { bitcoinNetwork, cat21Config } from '../../shared/sdk-tokens';
import { cat21OrchestratorPorts } from '../../shared/cat21-orchestrator-ports';
import { inscriptionReviewLink } from '../../shared/funding-asset-links';
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

  /* jscpd:ignore-start -- the per-consumer B1 seam tests (mint/transfer/make-offer)
     are intentionally the same shape; each proves its OWN page names the picked
     coin, so they are not a DRY violation to factor out. */
  // B1: when no clean coin covers (status asset-notice), picking a DIFFERENT asset
  // coin must make the notice name the coin the mint WILL spend (the resolved
  // pick), not the recommended one. Reverting `noticeAssets` to `recommended.assets`
  // turns this red.
  it('after picking a different asset coin, the notice names the PICKED coin, not the recommended one', async () => {
    const INSCRIPTION_A = `${'a'.repeat(64)}i0`; // on the recommended coin
    const INSCRIPTION_B = `${'b'.repeat(64)}i0`; // on the picked coin
    const recommended = fundingCoin(30_000, 0x70);
    const picked = fundingCoin(60_000, 0x71);
    const m = await mount({ coins: [recommended, picked] });
    io!.setOutput(outpointKey(recommended), inscribedOutputFixture(INSCRIPTION_A));
    io!.setOutput(outpointKey(picked), inscribedOutputFixture(INSCRIPTION_B));
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => m.q('mint-asset-notice') !== null, 'notice rendered');
    expect(text(m.q('mint-asset-notice-inscription'))).toBe(INSCRIPTION_A);

    (m.el.querySelector(`button[data-testid="utxo-pick-override-${picked.txid}"]`) as HTMLButtonElement).click();
    await m.until(
      () => m.fixture.componentInstance.resolvedFundingUtxo()?.txid === picked.txid
        && m.fixture.componentInstance.resolvedFundingStatus() !== 'scanning',
      'picked coin resolved',
    );
    expect(text(m.q('mint-asset-notice-inscription'))).toBe(INSCRIPTION_B);
  });
  /* jscpd:ignore-end */
});

describe('Mint: deliberately picking an asset coin while a clean coin covers (audit B1, > 50k)', () => {

  // The audit case: a clean coin is recommended, but the person picks a LARGE
  // asset coin (above AUTO_SCAN_MAX_VALUE_SAT = 50k). The recommendation
  // force-scans every covering coin, and the picker reads that one shared scan,
  // so the big coin shows as an asset (not "not scanned") and the picker offers
  // "Use anyway". Picking it must raise the stronger asset-found-warning BEFORE
  // the mint click, naming the PICKED coin's inscription. A private scanner here
  // (the pre-fix wiring) left the coin unscanned, so this warning never showed.
  it('shows the asset-found-warning naming the picked coin, with the mint CTA still enabled', async () => {
    const INSCRIPTION = `${'c'.repeat(64)}i0`;
    const clean = fundingCoin(100_000, 0x74);        // recommended (clean, covers)
    const bigAsset = fundingCoin(2_000_000, 0x75);   // > 50k, carries an inscription
    const m = await mount({ coins: [clean, bigAsset] });
    io!.setOutput(outpointKey(clean), cleanOutputFixture());
    io!.setOutput(outpointKey(bigAsset), inscribedOutputFixture(INSCRIPTION));
    await m.connect(testWallet(), 'auto'); // a clean coin covers -> auto-pick, no notice

    // The big asset coin is force-scanned by the recommendation and shows as an
    // asset in the picker (not "not scanned"), despite being above the 50k cap.
    const assetRow = m.q(`utxo-row-${bigAsset.txid}-${bigAsset.vout}`);
    await m.until(() => assetRow?.getAttribute('data-bucket') === 'assets', 'big coin scanned to assets');
    // Nothing warns yet: the recommended (clean) coin is the one that would spend.
    expect(m.q('asset-found-warning')).toBeNull();

    // The person picks the big asset coin.
    (m.el.querySelector(`button[data-testid="utxo-pick-override-${bigAsset.txid}"]`) as HTMLButtonElement).click();
    await m.until(
      () => m.fixture.componentInstance.resolvedFundingUtxo()?.txid === bigAsset.txid
        && m.fixture.componentInstance.resolvedFundingStatus() !== 'scanning',
      'big asset coin resolved',
    );

    // The stronger danger warning is up BEFORE the mint click and names the coin.
    const warning = m.q('asset-found-warning');
    expect(warning).not.toBeNull();
    expect(text(warning)).toContain(INSCRIPTION);
    // Informational, not a hard block: the person owns their funds.
    expect(m.cta().disabled).toBe(false);
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
      assets: { inscriptionIds: [INSCRIPTION_ID], runeNames: [], catIds: [], cats: [], rareSat: null },
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

/*
 * Cat numbers on every funding surface (seam: SDK scanner -> page). The real
 * UtxoContentScanner reads the cat's number from cat21-ord's /inscription
 * (the SDK's captured regtest answer for cat #2), and the picker row, the asset
 * notice, the expert-required warning and the asset-found-warning each name it
 * as "Cat #2", linked to /cat/2. Load-bearing: the SDK's own suite proves the
 * scan carries `cats`; only this proves the page renders them.
 */
describe('Mint: cats on a funding coin are named by number', () => {
  const CAT_ID = cat21OrdCatInscriptionFixture.id;

  /** The `Cat #N` links under `root` with the given testid. */
  const catLinks = (root: Element | null, testid: string) =>
    Array.from(root?.querySelectorAll(`[data-testid="${testid}"]`) ?? []).map((a) => ({
      label: text(a),
      href: a.getAttribute('href'),
    }));

  it('the asset notice and the picker row name the cat as "Cat #2", linked to /cat/2', async () => {
    const coin = fundingCoin(30_000, 0x80);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), catOutputFixture(CAT_ID));
    io!.setInscription(CAT_ID, cat21OrdCatInscriptionFixture);
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => m.q('mint-asset-notice-cat') !== null, 'notice cat rendered');
    expect(catLinks(m.el, 'mint-asset-notice-cat')).toEqual([{ label: 'Cat #2', href: '/cat/2' }]);
    const row = m.q(`utxo-row-${coin.txid}-${coin.vout}`);
    expect(catLinks(row, 'utxo-asset-cat')).toEqual([{ label: 'Cat #2', href: '/cat/2' }]);
  });

  it('the expert-required warning (one-address wallet) names the cat as "Cat #2"', async () => {
    const coin = fundingCoin(30_000, 0x81);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), catOutputFixture(CAT_ID));
    io!.setInscription(CAT_ID, cat21OrdCatInscriptionFixture);
    await m.connect(oneAddressTestWallet(), 'expert-required');
    await m.until(() => m.q('mint-funding-expert-required-cat') !== null, 'warning cat rendered');
    expect(catLinks(m.el, 'mint-funding-expert-required-cat')).toEqual([{ label: 'Cat #2', href: '/cat/2' }]);
    expect(m.cta().disabled).toBe(true);
  });

  it('the asset-found-warning on a deliberately picked cat coin names "Cat #2"', async () => {
    const clean = fundingCoin(100_000, 0x82);
    const catCoin = fundingCoin(60_000, 0x83);
    const m = await mount({ coins: [clean, catCoin] });
    io!.setOutput(outpointKey(clean), cleanOutputFixture());
    io!.setOutput(outpointKey(catCoin), catOutputFixture(CAT_ID));
    io!.setInscription(CAT_ID, cat21OrdCatInscriptionFixture);
    await m.connect(testWallet(), 'auto');
    const row = m.q(`utxo-row-${catCoin.txid}-${catCoin.vout}`);
    await m.until(() => row?.getAttribute('data-bucket') === 'assets', 'cat coin scanned to assets');
    (m.el.querySelector(`button[data-testid="utxo-pick-override-${catCoin.txid}"]`) as HTMLButtonElement).click();
    await m.until(() => m.q('asset-found-warning-cat') !== null, 'asset-found-warning cat rendered');
    expect(catLinks(m.el, 'asset-found-warning-cat')).toEqual([{ label: 'Cat #2', href: '/cat/2' }]);
  });

  // The Genesis Cat's number is 0, which is falsy: a truthiness check on the
  // number (`cat.number ? ...`) sends it to the unnumbered fallback. Same
  // captured /inscription answer, number set to 0.
  it('the Genesis Cat (number 0) is named "Cat #0", linked to /cat/0, not the fallback', async () => {
    const coin = fundingCoin(30_000, 0x85);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), catOutputFixture(CAT_ID));
    io!.setInscription(CAT_ID, { ...cat21OrdCatInscriptionFixture, number: 0 });
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => m.q('mint-asset-notice-cat') !== null, 'notice cat rendered');
    expect(catLinks(m.el, 'mint-asset-notice-cat')).toEqual([{ label: 'Cat #0', href: '/cat/0' }]);
    const row = m.q(`utxo-row-${coin.txid}-${coin.vout}`);
    expect(catLinks(row, 'utxo-asset-cat')).toEqual([{ label: 'Cat #0', href: '/cat/0' }]);
  });

  it('a cat whose number cat21-ord cannot give keeps its inscription id and link', async () => {
    const coin = fundingCoin(30_000, 0x84);
    const m = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), catOutputFixture(CAT_ID));
    io!.setInscription(CAT_ID, 'not-found');
    await m.connect(testWallet(), 'asset-notice');
    await m.until(() => m.q('mint-asset-notice-cat') !== null, 'notice cat rendered');
    expect(catLinks(m.el, 'mint-asset-notice-cat')).toEqual([{ label: CAT_ID, href: inscriptionReviewLink(CAT_ID) }]);
    // The picker row knows the sat, so its fallback is the sat page.
    const row = m.q(`utxo-row-${coin.txid}-${coin.vout}`);
    const [pick] = catLinks(row, 'utxo-asset-cat');
    expect(pick.label).toBe('CAT-21 cat');
    expect(pick.href).toMatch(/^https:\/\/cat21\.space\/sat\/\d+$/);
  });
});

/*
 * A retry scan must reach the orchestrator. The picker's "Retry scan" asks the
 * shared scanner; without a re-read afterwards the recommendation keeps the
 * pinned coin as 'failed' and mint() spends it even though the retry just
 * found an inscription on it. With the re-read the SDK compares the pin's
 * shown content ('failed') with the new scan ('assets') and drops the pin as
 * `contents-changed`: the notice names it, and a mint click is refused with a
 * confirm-again message instead of spending it.
 */
describe('Mint: a retry scan on a pinned coin reaches the recommendation', () => {
  it('a pinned coin whose retry finds an inscription is dropped as contents-changed, and the mint click is refused', async () => {
    const INSCRIPTION = `${'d'.repeat(64)}i0`;
    const clean = fundingCoin(100_000, 0x90);
    const flaky = fundingCoin(60_000, 0x91);
    const m = await mount({ coins: [clean, flaky] });
    io!.setOutput(outpointKey(clean), cleanOutputFixture());
    io!.setOutput(outpointKey(flaky), notIndexedOutputFixture());
    await m.connect(testWallet(), 'auto');
    const row = () => m.q(`utxo-row-${flaky.txid}-${flaky.vout}`);
    await m.until(() => row()?.getAttribute('data-bucket') === 'failed', 'flaky coin shows scan failed');

    // The person pins the coin whose scan failed.
    (m.el.querySelector(`button[data-testid="utxo-pick-${flaky.txid}"]`) as HTMLButtonElement).click();
    await m.until(() => m.fixture.componentInstance.resolvedFundingUtxo()?.txid === flaky.txid, 'flaky coin pinned');

    // ord catches up: the coin carries an inscription. The picker's Retry scan.
    io!.setOutput(outpointKey(flaky), inscribedOutputFixture(INSCRIPTION));
    (m.q(`utxo-scan-${flaky.txid}`) as HTMLButtonElement).click();
    await m.until(() => m.fixture.componentInstance.droppedSelection()?.reason === 'contents-changed', 'pin dropped as contents-changed');

    expect(text(m.q('mint-dropped-selection'))).toContain('now carries assets that were not shown when you picked it');
    expect(m.fixture.componentInstance.resolvedFundingUtxo()?.txid).toBe(clean.txid);

    // The click is refused, not silently moved to another coin: the SDK asks
    // the person to confirm a coin again, naming the dropped one. Nothing is
    // signed or broadcast.
    provider = installFakeCat21Provider();
    await m.fixture.componentInstance.mint();
    expect(m.fixture.componentInstance.fundingReconfirm()).toBe(
      `The selected funding UTXO ${outpointKey(flaky)} now carries assets that were not shown when it was selected. Confirm a funding UTXO again.`,
    );
    expect(provider.requests).toEqual([]);
    expect(io!.broadcasts).toEqual([]);
  });
});
