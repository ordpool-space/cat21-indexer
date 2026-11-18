/**
 * @test-kind unit
 * Real:   MakeOffer component with its real template and children (FeesPicker, UtxoPicker, FundingAssetList,
 *         SingleAddressNote, WalletCapabilityNotice, WalletConnect); the SDK Cat21CreateOfferOrchestrator on the
 *         production port wiring (cat21OrchestratorPorts, 'derive'), the SDK Cat21Service and UtxoContentScanner,
 *         recommendFunding; CatUtxoLookupService, OrdApiService, Cat21BidsService (none is asked anything here)
 * Faked:  fetch (testing/funding-fetch.fixtures): electrs' UTXO list (fundingCoin rows built on electrsConfirmedUtxoFixture, ordpool-sdk/testing), the fee tiers
 *         (recommendedFeesFixture, ordpool-sdk) and ord + cat21-ord /output (inscribedOutputFixture,
 *         notIndexedOutputFixture, ordpool-sdk)
 *         unnamed-assets only: the orchestrator's scan port answers 'has-assets' with no detail, or with a detail
 *         whose fields are all empty (ContentScanPort shape), the answers a port that cannot name assets gives
 *         HttpClient -> HttpTestingController (nothing answered)
 *         window.Cat21Provider (the wallet API) -> installFakeCat21Provider, signing with the test wallet's keys
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         The cat, seller payment address and price are set on the real orchestrator, as the page does after a
 *         lookup and the form inputs
 * Proves: each expert-required cause renders its own warning (named assets listed and linked, unnamed assets,
 *         unknown content), the offer CTA stays disabled and no coin carries the recommended star; a
 *         separate-address wallet whose only cover is unnamed or unchecked gets that warning and a disabled CTA,
 *         never an empty notice beside an enabled CTA; the asset notice names the coin, keeps the CTA enabled
 *         and the star; an offer that reaches the orchestrator on expert-required is refused with a
 *         FundingBlockedError whose cause and coin are the ones the warning shows, and signs nothing; on the
 *         notice the CTA builds the offer, funded by that coin
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import {
  BuyOfferTargetCat,
  Cat21CreateOfferOrchestrator,
  Cat21Service,
  ContentScanPort,
  Network,
  TxnOutput,
  UtxoContentScanner,
  WalletInfo,
  WalletService,
  inscribedOutputFixture,
  isFundingBlockedError,
  notIndexedOutputFixture,
  outpointKey,
} from 'ordpool-sdk';

import { bitcoinNetwork, cat21Config } from '../../../shared/sdk-tokens';
import { cat21OrchestratorPorts } from '../../../shared/cat21-orchestrator-ports';
import { MakeOffer } from './make-offer';
import { FUNDING_TEST_CONFIG, FundingFetch, installFundingFetch } from '../../../testing/funding-fetch.fixtures';
import { WalletServiceStub } from '../../../testing/wallet.fixtures';
import {
  TEST_PAYMENT_ADDRESS,
  fundingCoin,
  installFakeCat21Provider,
  oneAddressTestWallet,
  testWallet,
} from '../../../testing/test-wallet.fixtures';

const INSCRIPTION_ID = `${'e'.repeat(64)}i0`;
/** The seller's cat on a real P2TR output whose key is not the test wallet's. */
const TARGET: BuyOfferTargetCat = {
  catNumber: 42,
  txid: 'aa'.repeat(32),
  vout: 0,
  value: 546,
  scriptPubKey: btc.p2tr(schnorr.getPublicKey(hex.decode('31'.repeat(32))), undefined, btc.NETWORK).script,
};
/** Where the seller wants to be paid: a real P2WPKH address of a seller key. */
const SELLER_PAYMENT_ADDRESS = btc.p2wpkh(secp256k1.getPublicKey(hex.decode('32'.repeat(32)), true), btc.NETWORK).address ?? '';
const PRICE = 21_000;

/** Collapse template whitespace so a sentence compares as one line. */
const text = (el: Element | null): string | null => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

type ScanWiring = 'scanner' | 'bare-has-assets' | 'empty-detail';

let io: FundingFetch | null = null;
let provider: ReturnType<typeof installFakeCat21Provider> | null = null;

afterEach(() => {
  io?.restore();
  io = null;
  provider?.restore();
  provider = null;
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
  const orch = new Cat21CreateOfferOrchestrator({
    ...cat21OrchestratorPorts(cat21, FUNDING_TEST_CONFIG, Network.Mainnet, 'derive'),
    scan: ports[opts.scan ?? 'scanner'],
  });
  const wallets = new WalletServiceStub();

  await TestBed.configureTestingModule({
    imports: [MakeOffer],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: cat21Config, useValue: FUNDING_TEST_CONFIG },
      { provide: bitcoinNetwork, useValue: Network.Mainnet },
      { provide: Cat21Service, useValue: cat21 },
      { provide: UtxoContentScanner, useValue: scanner },
      { provide: WalletService, useValue: wallets },
      { provide: Cat21CreateOfferOrchestrator, useValue: orch },
    ],
  }).compileComponents();

  const fixture: ComponentFixture<MakeOffer> = TestBed.createComponent(MakeOffer);
  const component = fixture.componentInstance;
  const el: HTMLElement = fixture.nativeElement;
  fixture.detectChanges();

  async function until(done: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      fixture.detectChanges();
      if (done()) return;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`never reached: ${what} (status ${component.buyerFundingRecommendation().status})`);
  }

  /** Connect `w`, fill the offer, and wait for the SDK's verdict at the seeded fee rate. */
  async function connect(w: WalletInfo, status: string): Promise<void> {
    wallets.connectedWalletSubject.next(w);
    await until(() => component.state() === 'ready', 'wallet ready');
    orch.setTargetCat(TARGET);
    orch.setSellerPaymentAddress(SELLER_PAYMENT_ADDRESS);
    orch.setPriceSats(PRICE);
    await until(() => component.buyerFundingRecommendation().status === status, `funding status ${status}`);
  }

  const q = (testid: string) => el.querySelector(`[data-testid="${testid}"]`);
  const cta = () => el.querySelector('button[data-testid="make-offer-cta"]') as HTMLButtonElement;
  const star = () => el.querySelector('[data-testid="utxo-recommended"]');

  return { fixture, component, el, orch, until, connect, q, cta, star };
}

describe('MakeOffer: the expert-required warning names its cause', () => {

  it('named-assets (one-address wallet, inscribed coin): the warning lists the inscription, linked', async () => {
    const coin = fundingCoin(60_000, 0x81);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(oneAddressTestWallet(), 'expert-required');

    expect(t.q('make-offer-funding-expert-required')?.getAttribute('data-cause')).toBe('named-assets');
    expect(text(t.q('make-offer-funding-expert-required-text'))).toBe(
      '⚠ None of your content-clean coins can cover price + cat value + fee. Your wallet keeps assets and ' +
        'payments on one address, and the coin that would cover the offer carries the assets below. Expand Funding ' +
        'source below and pick a coin deliberately (its asset would be spent into the trade), or add a plain ' +
        'payment UTXO to your wallet.',
    );
    const link = t.q('make-offer-funding-expert-required-inscription') as HTMLAnchorElement;
    expect(text(link)).toBe(INSCRIPTION_ID);
    expect(link.getAttribute('href')).toBe(`https://ordpool.space/tx/${'e'.repeat(64)}?artifact=${INSCRIPTION_ID}`);
    expect(t.q('make-offer-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('named-assets: the offer CTA is disabled', async () => {
    const coin = fundingCoin(60_000, 0x82);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(oneAddressTestWallet(), 'expert-required');
    expect(t.cta().disabled).toBe(true);
  });

  it('named-assets: the picker lists the coin and marks none as recommended', async () => {
    const coin = fundingCoin(60_000, 0x83);
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
    const coin = fundingCoin(60_000, 0x84);
    const t = await mount({ coins: [coin], scan });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'expert-required');

    expect(t.q('make-offer-funding-expert-required')?.getAttribute('data-cause')).toBe('unnamed-assets');
    expect(text(t.q('make-offer-funding-expert-required-text'))).toBe(
      '⚠ None of your content-clean coins can cover price + cat value + fee. The coins that can carry assets the ' +
        "scan could not name, so we can't tell you what the offer would give away. Expand Funding source below and " +
        'pick a coin only if you know what it holds (its asset would be spent into the trade), or add a plain ' +
        'payment UTXO to your wallet.',
    );
    expect(t.q('make-offer-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it.each<[string, ScanWiring]>([
    ['a bare has-assets verdict', 'bare-has-assets'],
    ['a detail that names nothing', 'empty-detail'],
  ])('unnamed-assets (%s): the offer CTA is disabled and no coin carries the star', async (_label, scan) => {
    const coin = fundingCoin(60_000, 0x85);
    const t = await mount({ coins: [coin], scan });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'expert-required');
    expect(t.cta().disabled).toBe(true);
    expect(t.star()).toBeNull();
  });

  it('unknown-content (separate-address wallet, only a coin ord has not indexed): its own warning', async () => {
    const coin = fundingCoin(60_000, 0x86);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await t.connect(testWallet(), 'expert-required');

    expect(t.q('make-offer-funding-expert-required')?.getAttribute('data-cause')).toBe('unknown-content');
    expect(text(t.q('make-offer-funding-expert-required-text'))).toBe(
      "⚠ None of your content-clean coins can cover price + cat value + fee, and we couldn't check the coins that " +
        'can for ordinal-bound assets. Expand Funding source below and pick a coin deliberately, or add a plain ' +
        'payment UTXO to your wallet.',
    );
    expect(t.q('make-offer-asset-notice')).toBeNull();
    expect(io!.unexpected).toEqual([]);
  });

  it('unknown-content: the offer CTA is disabled and no coin carries the star', async () => {
    const coin = fundingCoin(60_000, 0x87);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), notIndexedOutputFixture());
    await t.connect(testWallet(), 'expert-required');
    expect(t.cta().disabled).toBe(true);
    expect(t.star()).toBeNull();
  });
});

describe('MakeOffer: the asset notice (separate-address wallet, named assets) stays a notice', () => {

  it('names the inscription on the coin', async () => {
    const coin = fundingCoin(60_000, 0x88);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'asset-notice');
    expect(text(t.q('make-offer-asset-notice-inscription'))).toBe(INSCRIPTION_ID);
    expect(t.q('make-offer-funding-expert-required')).toBeNull();
  });

  it('keeps the offer CTA enabled and marks the coin as recommended', async () => {
    const coin = fundingCoin(60_000, 0x89);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    await t.connect(testWallet(), 'asset-notice');
    await t.until(() => !t.cta().disabled, 'CTA enabled');
    const row = t.q(`utxo-row-${coin.txid}-${coin.vout}`);
    expect(row?.querySelector('[data-testid="utxo-recommended"]')).not.toBeNull();
  });
});

describe('MakeOffer: a blocked offer renders the facts the FundingBlockedError carries', () => {

  it('named-assets: an offer that reaches the orchestrator is refused with the cause and coin the warning shows; nothing is signed', async () => {
    const coin = fundingCoin(60_000, 0x8a);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    provider = installFakeCat21Provider();
    await t.connect(oneAddressTestWallet(), 'expert-required');
    const createSpy = jest.spyOn(t.orch, 'createOffer');

    // The disabled CTA keeps a person out; a stale click reaches the handler directly.
    await expect(t.component.onCreateOfferClick()).resolves.toBeUndefined();
    t.fixture.detectChanges();

    const err: unknown = await (createSpy.mock.results[0]!.value as Promise<unknown>).catch((e: unknown) => e);
    expect(isFundingBlockedError(err)).toBe(true);
    if (!isFundingBlockedError(err)) return;
    expect(err.cause).toBe('named-assets');
    expect(t.q('make-offer-funding-expert-required')?.getAttribute('data-cause')).toBe(err.cause);
    expect(err.recommendation.recommended).toEqual({
      txid: coin.txid,
      vout: coin.vout,
      value: 60_000,
      bucket: 'assets',
      assets: { inscriptionIds: [INSCRIPTION_ID], runeNames: [], catIds: [], rareSat: null },
    });
    expect(text(t.q('make-offer-funding-expert-required-inscription'))).toBe(err.recommendation.recommended.assets?.inscriptionIds[0]);
    expect(t.cta().disabled).toBe(true);
    expect(provider.requests).toEqual([]);
    expect(t.orch.getSnapshot().bid).toBeNull();
  });
});

describe('MakeOffer: the asset notice proceeds to an offer funded by the noticed coin', () => {

  it('a separate-address wallet whose only cover carries a named inscription builds the offer after the notice, funded by that coin', async () => {
    const coin = fundingCoin(60_000, 0x8b);
    const t = await mount({ coins: [coin] });
    io!.setOutput(outpointKey(coin), inscribedOutputFixture(INSCRIPTION_ID));
    provider = installFakeCat21Provider();
    await t.connect(testWallet(), 'asset-notice');
    await t.until(() => t.q('make-offer-asset-notice') !== null && !t.cta().disabled, 'notice beside an enabled CTA');
    expect(text(t.q('make-offer-asset-notice-inscription'))).toBe(INSCRIPTION_ID);

    t.cta().click();
    await t.until(() => t.q('make-offer-success') !== null, 'offer built');

    const bid = t.orch.getSnapshot().bid;
    expect(bid).not.toBeNull();
    if (!bid) return;
    const tx = btc.Transaction.fromPSBT(hex.decode(bid.hex), { allowUnknownInputs: true, allowUnknownOutputs: true });
    const inputs = Array.from({ length: tx.inputsLength }, (_, i) => `${hex.encode(tx.getInput(i).txid!)}:${tx.getInput(i).index}`);
    expect(inputs).toEqual([`${TARGET.txid}:${TARGET.vout}`, outpointKey(coin)]);
    expect(provider.requests.map((r) => r.signAtIndex)).toEqual([[1]]);
    expect(io!.unexpected).toEqual([]);
  });
});
