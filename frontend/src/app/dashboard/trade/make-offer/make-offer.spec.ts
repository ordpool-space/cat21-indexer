/**
 * @test-kind unit
 * Real:   MakeOffer component; the SDK Cat21CreateOfferOrchestrator (funding recommendation, simulation, offer build
 *         and buyer signing run for real against the test wallet's keys)
 * Faked:  orchestrator ports getUtxos / scan -> fakePorts (testing/orchestrator-ports.fixtures; SDK port types)
 *         window.Cat21Provider (the wallet API) -> installFakeCat21Provider, signing with the test wallet's keys
 *         UtxoContentScanner -> ScannerStub (testing/scanner.fixtures)
 *         WalletService -> WalletServiceStub (testing/wallet.fixtures)
 *         CatUtxoLookupService, OrdApiService, Cat21BidsService -> hand-written stubs (sibling modules)
 * Proves: the seller payment address comes from the URL or the user, never from the on-chain owner; a moved cat
 *         marks the offer stale; a real buyer-signed offer is posted to the Bazaar with the live cats bundle, and a
 *         drifted, unknown or unreadable bundle is not; the seller receives price + the cat's real value; the expert
 *         picker follows the SDK's funding verdict
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { Observable, of, throwError } from 'rxjs';

import {
  BuyOfferTargetCat,
  Cat21CreateOfferOrchestrator,
  UtxoContentScanner,
  WalletInfo,
  WalletService,
} from 'ordpool-sdk';

import { cat21Config } from '../../../shared/sdk-tokens';
import { MakeOffer } from './make-offer';
import { Cat21BidsService, PersistedCat21Bid, PostBidArgs } from '../../../shared/cat21-bids.service';
import { CatUtxoLookupService } from '../../../shared/cat-utxo-lookup.service';
import { OrdApiService } from '../../../shared/ord-api.service';
import { WalletServiceStub } from '../../../testing/wallet.fixtures';
import { ScannerStub } from '../../../testing/scanner.fixtures';
import { assetsVerdict, fakePorts, FakePorts } from '../../../testing/orchestrator-ports.fixtures';
import {
  TEST_ORDINALS_ADDRESS,
  TEST_PAYMENT_ADDRESS,
  fundingCoin,
  installFakeCat21Provider,
  oneAddressTestWallet,
  testWallet,
} from '../../../testing/test-wallet.fixtures';

class OrdApiServiceStub {
  private catsAtOutputImpl: (txid: string, vout: number) => Observable<number[] | null> = () => of([]);
  setCatsAtOutput(fn: (txid: string, vout: number) => Observable<number[] | null>) {
    this.catsAtOutputImpl = fn;
  }
  getCatsAtOutput = (txid: string, vout: number) => this.catsAtOutputImpl(txid, vout);
  getCurrentOwner = jest.fn();
  getOutput = jest.fn();
}

class Cat21BidsServiceStub {
  postBid = jest.fn((_: PostBidArgs) => of({} as PersistedCat21Bid));
  getBidsForOutpoint = jest.fn();
  deleteBid = jest.fn();
}

// ---------------------------------------------------------------------------
// Distinct addresses ARE THE POINT of this spec. Splitting them ensures
// any "auto-fill payment address from the cat's on-chain owner lookup"
// regression re-appearing is caught: the on-chain owner returns the
// ordinals address, and that value must NEVER flow into sellerPaymentAddress.
// See SDK CLAUDE.md HARD RULE "Never derive a payment address from an
// on-chain lookup".
// ---------------------------------------------------------------------------

// The on-chain owner of any given cat is the seller's ordinals address
// (cats live on the ordinals key per ordinal theory). We hand this
// string to `getTargetByNumber(...).sellerAddress`, the same shape ord
// returns in production.
const CAT_OWNER_ORDINALS_ADDRESS = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';

/** The seller's cat sits on a real P2TR output; its key is not the test wallet's. */
const SELLER_CAT_SCRIPT = btc.p2tr(schnorr.getPublicKey(hex.decode('31'.repeat(32))), undefined, btc.NETWORK).script;
/** Where the seller wants to be paid: a real P2WPKH address of a seller key. */
const SELLER_PAYMENT_ADDRESS = btc.p2wpkh(secp256k1.getPublicKey(hex.decode('32'.repeat(32)), true), btc.NETWORK).address!;

const CAT_TXID = 'aa'.repeat(32);
const PRICE = 21_000;
const FEE_RATE = 5;

function target(over: Partial<BuyOfferTargetCat> = {}): BuyOfferTargetCat {
  return {
    catNumber: 42,
    txid: CAT_TXID,
    vout: 0,
    value: 546,
    scriptPubKey: SELLER_CAT_SCRIPT,
    ...over,
  };
}

class LookupStub {
  readonly getTargetByNumberImpl = jest.fn((_: number) =>
    of({ target: target(), sellerAddress: CAT_OWNER_ORDINALS_ADDRESS }),
  );
  getTargetByNumber = (n: number) => this.getTargetByNumberImpl(n);
  getMyHoldings = jest.fn();
}

let provider: ReturnType<typeof installFakeCat21Provider> | null = null;

afterEach(() => {
  provider?.restore();
  provider = null;
});

/**
 * Mount MakeOffer on a REAL create-offer orchestrator built from faked ports.
 * Spies call through, so the orchestrator keeps its real behaviour.
 */
async function mount(opts: { ports?: FakePorts; ordApi?: OrdApiServiceStub; bidsService?: Cat21BidsServiceStub } = {}) {
  const ports = opts.ports ?? fakePorts([fundingCoin(100_000, 0x41)]);
  const orchestrator = new Cat21CreateOfferOrchestrator(ports);
  const spies = {
    setTargetCat: jest.spyOn(orchestrator, 'setTargetCat'),
    setSellerPaymentAddress: jest.spyOn(orchestrator, 'setSellerPaymentAddress'),
    setPriceSats: jest.spyOn(orchestrator, 'setPriceSats'),
  };
  const walletService = new WalletServiceStub();
  const lookup = new LookupStub();
  const ordApi = opts.ordApi ?? new OrdApiServiceStub();
  const bidsService = opts.bidsService ?? new Cat21BidsServiceStub();

  await TestBed.configureTestingModule({
    imports: [MakeOffer],
    providers: [
      provideHttpClient(),
      provideRouter([]),
      { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
      { provide: UtxoContentScanner, useValue: new ScannerStub() },
      { provide: WalletService, useValue: walletService },
      { provide: CatUtxoLookupService, useValue: lookup },
      { provide: OrdApiService, useValue: ordApi },
      { provide: Cat21BidsService, useValue: bidsService },
      { provide: cat21Config, useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' } },
    ],
  })
    // Skip the template: this spec tests component logic, not the UI.
    .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
    .compileComponents();

  const fixture = TestBed.createComponent(MakeOffer);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  /** Flush effects and microtasks until `done()` holds; fails loudly instead of hanging. */
  async function until(done: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 500; i++) {
      fixture.detectChanges();
      if (done()) return;
      await Promise.resolve();
    }
    throw new Error(`never reached: ${what}`);
  }

  /** Connect a wallet and wait for its UTXOs to load. */
  async function connect(w: WalletInfo = testWallet()): Promise<void> {
    walletService.connectedWalletSubject.next(w);
    await until(() => component.state() === 'ready', 'wallet ready');
  }

  /** Fill every input the orchestrator needs to price the offer and wait for the verdict. */
  async function fillOffer(t: BuyOfferTargetCat = target()): Promise<void> {
    orchestrator.setTargetCat(t);
    orchestrator.setSellerPaymentAddress(SELLER_PAYMENT_ADDRESS);
    orchestrator.setPriceSats(PRICE);
    orchestrator.setFeeRate(FEE_RATE);
    await until(() => component.buyerFundingRecommendation().status !== 'scanning', 'funding verdict');
  }

  return { fixture, component, orchestrator, spies, ports, walletService, lookup, ordApi, bidsService, until, connect, fillOffer };
}

describe('MakeOffer regression — sellerPaymentAddress never derived from on-chain owner', () => {

  it('does NOT call setSellerPaymentAddress with the cat owner address after a lookup', async () => {
    const { component, spies, lookup, orchestrator } = await mount();
    // Arrange: buyer types a cat number; lookup returns the ordinals
    // address ord provided (= current owner).
    component.draft.update((d) => ({ ...d, catNumberInput: '42' }));

    // Act: this is the code path the buyer hits clicking "Look up cat".
    component.onLookupCatClick();

    // Assert 1: the ONE regression that must hold. Every call to
    // setSellerPaymentAddress (past + future) must NOT carry the
    // on-chain owner address, and the orchestrator does not hold it.
    for (const call of spies.setSellerPaymentAddress.mock.calls) {
      expect(call[0]).not.toBe(CAT_OWNER_ORDINALS_ADDRESS);
    }
    expect(orchestrator.getSnapshot().sellerPaymentAddress).toBeNull();

    // Assert 2: the ord lookup itself DID run (this test is not a
    // vacuous no-op because the subscriber never fired).
    expect(lookup.getTargetByNumberImpl).toHaveBeenCalledWith(42);

    // Assert 3: setTargetCat's FINAL call receives the parsed target
    // (that part of the lookup is legitimate: the target's txid + vout
    // + scriptPubKey are cat-outpoint context, not address-type
    // context). The lookup first clears with `null` then sets the
    // resolved target.
    expect(spies.setTargetCat).toHaveBeenCalledTimes(2);
    const calls = spies.setTargetCat.mock.calls;
    expect(calls[0]![0]).toBeNull();
    expect((calls[1]![0] as BuyOfferTargetCat).catNumber).toBe(42);
    expect(orchestrator.getSnapshot().targetCat?.catNumber).toBe(42);
  });

  it('does propagate a URL-supplied payTo into the orchestrator (the correct source)', async () => {
    const { fixture, spies, orchestrator, connect } = await mount();
    // The `payTo` URL param comes from the seller's own wallet at
    // sell-modal-open time: that's the sanctioned source for the
    // payment address. Prove this input signal path DOES reach the
    // orchestrator so the bug fix doesn't cut off the intended flow.
    fixture.componentRef.setInput('catNumber', '42');
    fixture.componentRef.setInput('payTo', SELLER_PAYMENT_ADDRESS);
    // The prefill effect reads `this.connectedWallet()`, sourced from
    // WalletService.connectedWallet$.
    await connect();

    const paymentCalls = spies.setSellerPaymentAddress.mock.calls.map((c) => c[0]);
    expect(paymentCalls).toContain(SELLER_PAYMENT_ADDRESS);
    // And critically: NOT the ordinals address.
    expect(paymentCalls).not.toContain(TEST_ORDINALS_ADDRESS);
    expect(paymentCalls).not.toContain(CAT_OWNER_ORDINALS_ADDRESS);
    expect(orchestrator.getSnapshot().sellerPaymentAddress).toBe(SELLER_PAYMENT_ADDRESS);
  });
});

describe('MakeOffer — catOutpoint intent-lock (stale detection)', () => {

  const URL_TXID = 'aa'.repeat(32); // outpoint the seller's link was pinned to
  const OTHER_TXID = 'bb'.repeat(32); // cat's current outpoint (differs → stale)

  it('URL-supplied catTxid + catVout parse via linkedOutpoint()', async () => {
    const { fixture } = await mount();
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    fixture.detectChanges();
    expect(fixture.componentInstance.linkedOutpoint()).toEqual({ txid: URL_TXID, vout: 0 });
  });

  it('staleOffer=true when URL outpoint ≠ orchestrator targetCat outpoint (cat moved)', async () => {
    const { fixture, component, orchestrator, connect, fillOffer } = await mount();
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    await connect();
    // The on-chain lookup completes with a DIFFERENT outpoint (the cat
    // has moved since the URL was minted). Everything else is ready, so
    // the stale lock is the only thing keeping the CTA disabled.
    await fillOffer(target({ txid: OTHER_TXID, vout: 0 }));
    expect(orchestrator.getSnapshot().simulation).not.toBeNull();

    expect(component.staleOffer()).toBe(true);
    expect(component.canCreateOffer()).toBe(false);
  });

  it('staleOffer=false when URL outpoint == orchestrator targetCat outpoint (fresh link)', async () => {
    const { fixture, component, connect, fillOffer } = await mount();
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    await connect();
    await fillOffer(target({ txid: URL_TXID, vout: 0 }));

    expect(component.staleOffer()).toBe(false);
    // The same fully-filled form IS creatable when the link is fresh.
    expect(component.canCreateOffer()).toBe(true);
  });

  it('staleOffer=false when URL has no intent-lock (legacy link — no stale check)', async () => {
    const { component, orchestrator, fixture } = await mount();
    orchestrator.setTargetCat(target({ txid: OTHER_TXID, vout: 0 }));
    fixture.detectChanges();

    expect(component.linkedOutpoint()).toBeNull();
    expect(component.staleOffer()).toBe(false);
  });

  it('staleOffer=false while the lookup has not resolved (do NOT block the form before truth is known)', async () => {
    const { fixture, component } = await mount();
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    // targetCat stays null (lookup in flight).
    fixture.detectChanges();

    expect(component.targetCat()).toBeNull();
    expect(component.staleOffer()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('MakeOffer — Post to Bazaar (X.5)', () => {

  async function setupBazaar(opts: {
    withOffer?: boolean;
    catsAtOutput?: (txid: string, vout: number) => Observable<number[] | null>;
    onPost?: (args: PostBidArgs) => Observable<PersistedCat21Bid>;
  } = {}) {
    const ordApi = new OrdApiServiceStub();
    const bidsService = new Cat21BidsServiceStub();
    if (opts.catsAtOutput) ordApi.setCatsAtOutput(opts.catsAtOutput);
    if (opts.onPost) bidsService.postBid = jest.fn(opts.onPost) as never;

    const ctx = await mount({ ordApi, bidsService });
    await ctx.connect();

    if (opts.withOffer !== false) {
      // A completed offer flow: target, seller-payment address, price and
      // fee rate set; the wallet buyer-signs the real offer PSBT.
      provider = installFakeCat21Provider();
      await ctx.fillOffer(target({ txid: CAT_TXID, vout: 0 }));
      expect(ctx.component.canCreateOffer()).toBe(true);
      await ctx.component.onCreateOfferClick();
      await ctx.until(() => ctx.component.offerArtifact() !== null, 'offer artifact');
    }
    return { ...ctx, bidsService, ordApi };
  }

  /** Let the publish chain (ord lookup, then POST) settle. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('canPostToBazaar() is false without an offer artifact', async () => {
    const { component } = await setupBazaar({ withOffer: false });
    expect(component.offerArtifact()).toBeNull();
    expect(component.canPostToBazaar()).toBe(false);
  });

  it('canPostToBazaar() is true once the offer artifact + target are set', async () => {
    const { component } = await setupBazaar({ catsAtOutput: () => of([42]) });
    expect(component.canPostToBazaar()).toBe(true);
  });

  it('the offer artifact is the wallet-signed buyer PSBT: input 1 signed, the seller\'s cat input left for the seller', async () => {
    const { component } = await setupBazaar({ catsAtOutput: () => of([42]) });
    expect(provider!.requests.map((r) => r.signAtIndex)).toEqual([[1]]);
    const tx = btc.Transaction.fromPSBT(hex.decode(component.offerArtifact()!.hex));
    expect(hex.encode(tx.getInput(0).txid!)).toBe(CAT_TXID);
    // The seller's cat input (0) is left entirely for the seller: unsigned and
    // not finalised.
    expect(tx.getInput(0).partialSig ?? tx.getInput(0).tapKeySig).toBeUndefined();
    expect(tx.getInput(0).finalScriptWitness).toBeUndefined();
    // The buyer input (1) is FINALISED, not merely partially signed: ord's
    // `wallet offer accept` rejects a non-finalised buyer input (and any input
    // that carries a sighashType), so the SDK finalises the buyer input. A
    // finalised P2WPKH input carries a [signature, pubkey] witness and no
    // partialSig.
    expect(tx.getInput(1).partialSig).toBeUndefined();
    expect(tx.getInput(1).finalScriptWitness?.length).toBe(2);
  });

  it('onPostToBazaarClick fetches cats + calls bidsService.postBid with the assembled args', async () => {
    const { component, bidsService, ordApi } = await setupBazaar({
      catsAtOutput: () => of([42]),
      onPost: () => of({
        id: 'uuid-x',
        network: 'mainnet',
        catTxid: CAT_TXID,
        catVout: 0,
        cats: [42],
        headlineCatNumber: 42,
        bidSats: PRICE,
        buyerOrdinalsAddress: TEST_ORDINALS_ADDRESS,
        buyerPaymentAddress: TEST_PAYMENT_ADDRESS,
        sellerPaymentAddress: SELLER_PAYMENT_ADDRESS,
        psbtBase64: 'cHNidP8BAP0Y',
        createdAt: '2026-07-22T10:00:00Z',
      }),
    });
    const catsSpy = jest.spyOn(ordApi, 'getCatsAtOutput');

    component.onPostToBazaarClick();
    await flush();

    expect(catsSpy).toHaveBeenCalledWith(CAT_TXID, 0);
    expect(bidsService.postBid).toHaveBeenCalledTimes(1);
    expect((bidsService.postBid as jest.Mock).mock.calls[0]?.[0]).toEqual({
      catTxid: CAT_TXID,
      catVout: 0,
      cats: [42],
      headlineCatNumber: 42,
      bidSats: PRICE,
      buyerOrdinalsAddress: TEST_ORDINALS_ADDRESS,
      buyerPaymentAddress: TEST_PAYMENT_ADDRESS,
      sellerPaymentAddress: SELLER_PAYMENT_ADDRESS,
      // The exact bytes the wallet signed, not a re-encoding.
      psbtBase64: component.offerArtifact()!.base64,
    });
    expect(component.bidPublishState()).toBe('success');
    expect(component.bidPublishedRow()?.id).toBe('uuid-x');
  });

  it('surfaces cats-bundle-drift when the target catNumber is not in the fetched bundle', async () => {
    // ord reports [7, 100]: cat #42 (target headline) has moved off
    // this UTXO. postBid must NOT be called; UI shows drift error.
    const { component, bidsService } = await setupBazaar({
      catsAtOutput: () => of([7, 100]),
    });

    component.onPostToBazaarClick();
    await flush();

    expect(bidsService.postBid).not.toHaveBeenCalled();
    expect(component.bidPublishState()).toBe('error');
    expect(component.bidPublishError()?.code).toBe('cats-bundle-drift');
  });

  it('surfaces cat-not-found when cat21-ord does not know the outpoint (null)', async () => {
    // getCatsAtOutput emits null for a 404: the UTXO is spent or not
    // indexed yet. Same code the backend answers for it; nothing is posted.
    const { component, bidsService } = await setupBazaar({
      catsAtOutput: () => of(null),
    });

    component.onPostToBazaarClick();
    await flush();

    expect(bidsService.postBid).not.toHaveBeenCalled();
    expect(component.bidPublishState()).toBe('error');
    expect(component.bidPublishError()).toEqual({
      code: 'cat-not-found',
      detail: expect.stringContaining(`${CAT_TXID}:0`),
    });
  });

  it('surfaces backend errors from postBid (e.g. cats-bundle-drift server-side) via bidPublishError', async () => {
    const { component } = await setupBazaar({
      catsAtOutput: () => of([42]),
      onPost: () => throwError(() => ({ code: 'cats-bundle-drift', detail: 'live [42, 99]' } as never)),
    });

    component.onPostToBazaarClick();
    await flush();

    expect(component.bidPublishState()).toBe('error');
    expect(component.bidPublishError()?.code).toBe('cats-bundle-drift');
  });

  it('surfaces ord fetch failures via ord-lookup-failed', async () => {
    const { component, bidsService } = await setupBazaar({
      catsAtOutput: () => throwError(() => new Error('boom')),
    });

    component.onPostToBazaarClick();
    await flush();

    expect(bidsService.postBid).not.toHaveBeenCalled();
    expect(component.bidPublishState()).toBe('error');
    expect(component.bidPublishError()?.code).toBe('ord-lookup-failed');
  });

  it('onResetClick clears the bid publish state so the same MakeOffer instance can post again', async () => {
    const { component } = await setupBazaar({
      catsAtOutput: () => of([42]),
      onPost: () => of({} as PersistedCat21Bid),
    });
    component.onPostToBazaarClick();
    await flush();
    expect(component.bidPublishState()).toBe('success');

    component.onResetClick();
    expect(component.bidPublishState()).toBe('idle');
    expect(component.bidPublishError()).toBeNull();
    expect(component.bidPublishedRow()).toBeNull();
    expect(component.offerArtifact()).toBeNull();
  });
});

describe('MakeOffer: offer accounting is preserve-V (never 546) + expert-required funding', () => {

  it('sellerReceivesSats = price + the cat\'s REAL value (9000), never price + 546', async () => {
    const { component, orchestrator, fixture } = await mount();
    // A cat riding a 9000-sat UTXO, the exact non-546 case a 546-hardcode
    // would hide. ord routes `priceSats + sellerInput.value` to the seller's
    // payment output, so the seller receives price + V, not price + 546.
    orchestrator.setTargetCat(target({ value: 9_000 }));
    orchestrator.setPriceSats(100_000);
    fixture.detectChanges();
    expect(component.sellerReceivesSats()).toBe(109_000);
    expect(component.sellerReceivesSats()).not.toBe(100_546);
  });

  it('sellerReceivesSats is null until BOTH price and the cat lookup resolve', async () => {
    const { component, orchestrator, fixture } = await mount();
    expect(component.sellerReceivesSats()).toBeNull();
    orchestrator.setTargetCat(target({ value: 9_000 }));
    fixture.detectChanges();
    expect(component.sellerReceivesSats()).toBeNull(); // price still missing
    orchestrator.setPriceSats(50_000);
    fixture.detectChanges();
    expect(component.sellerReceivesSats()).toBe(59_000);
  });

  it('buyerFundingExpertRequired is false while the verdict is still open (scanning)', async () => {
    const { component, connect } = await mount();
    // Coins are loaded but no offer inputs yet: the SDK has nothing to
    // price, so its recommendation stays 'scanning'.
    await connect();
    expect(component.buyerFundingRecommendation().status).toBe('scanning');
    expect(component.buyerFundingExpertRequired()).toBe(false);
  });

  it('buyerFundingExpertRequired is false when a clean coin covers (auto)', async () => {
    const { component, connect, fillOffer } = await mount();
    await connect();
    await fillOffer();
    expect(component.buyerFundingRecommendation().status).toBe('auto');
    expect(component.buyerFundingExpertRequired()).toBe(false);
  });

  it('buyerFundingExpertRequired is true when only an asset coin covers on a one-address wallet', async () => {
    const coin = fundingCoin(100_000, 0x51);
    const ports = fakePorts([coin]);
    ports.setVerdict(`${coin.txid}:${coin.vout}`, assetsVerdict({ inscriptionIds: [`${'e'.repeat(64)}i0`] }));
    const { component, connect, fillOffer } = await mount({ ports });
    await connect(oneAddressTestWallet());
    await fillOffer();
    expect(component.buyerFundingRecommendation().status).toBe('expert-required');
    expect(component.buyerFundingExpertRequired()).toBe(true);
    // No coin is chosen for the user, so the offer cannot be built.
    expect(component.simulation()).toBeNull();
    expect(component.canCreateOffer()).toBe(false);
  });
});
