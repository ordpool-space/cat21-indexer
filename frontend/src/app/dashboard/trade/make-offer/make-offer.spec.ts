import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';

import {
  BuyOfferTargetCat,
  Cat21CreateOfferOrchestrator,
  CreateOfferSimulationOutcome,
  RecommendedFees,
  TxnOutput,
  UtxoContentScanner,
  UtxoScanState,
  WalletInfo,
  WalletService,
  cat21Config,
} from 'ordpool-sdk';

import { MakeOffer } from './make-offer';
import { Cat21BidsService, PersistedCat21Bid, PostBidArgs } from '../../../shared/cat21-bids.service';
import { CatUtxoLookupService } from '../../../shared/cat-utxo-lookup.service';
import { OrdApiService } from '../../../shared/ord-api.service';
import { makeWallet, WalletServiceStub } from '../../../testing/wallet.fixtures';

class OrdApiServiceStub {
  private catsAtOutputImpl: (txid: string, vout: number) => Observable<number[]> = () => of([]);
  setCatsAtOutput(fn: (txid: string, vout: number) => Observable<number[]>) {
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
// regression re-appearing is caught — the on-chain owner returns the
// ordinals address, and that value must NEVER flow into sellerPaymentAddress.
// See SDK CLAUDE.md HARD RULE "Never derive a payment address from an
// on-chain lookup".
// ---------------------------------------------------------------------------
const WALLET_ORDINALS_ADDRESS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const WALLET_PAYMENT_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';

// The on-chain owner of any given cat is the seller's ordinals address
// (cats live on the ordinals key per ordinal theory). We hand this
// string to `getTargetByNumber(...).sellerAddress` — the same shape ord
// returns in production.
const CAT_OWNER_ORDINALS_ADDRESS = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';

// Local wrapper — same shape as the shared `makeWallet` but with the
// spec's specific WALLET_* addresses baked in as the defaults. Callers
// can still override any field.
const wallet = (over: Partial<WalletInfo> = {}): WalletInfo =>
  makeWallet({
    ordinalsAddress: WALLET_ORDINALS_ADDRESS,
    paymentAddress: WALLET_PAYMENT_ADDRESS,
    ...over,
  });

function target(over: Partial<BuyOfferTargetCat> = {}): BuyOfferTargetCat {
  return {
    catNumber: 42,
    txid: 'a'.repeat(64),
    vout: 0,
    value: 546,
    scriptPubKey: new Uint8Array([0x51, 0x20]),
    ...over,
  };
}

class OrchestratorStub {
  readonly connectedWallet: WritableSignal<WalletInfo | null> = signal(null);
  readonly state: WritableSignal<'idle' | 'loading-utxos' | 'ready' | 'signing' | 'success' | 'error'> = signal('idle');
  readonly errorMessage: WritableSignal<string | null> = signal(null);
  readonly offerArtifact: WritableSignal<{ base64: string; hex: string } | null> = signal(null);
  readonly feeRate: WritableSignal<number | null> = signal(null);
  readonly targetCat: WritableSignal<BuyOfferTargetCat | null> = signal(null);
  readonly sellerPaymentAddress: WritableSignal<string | null> = signal(null);
  readonly priceSats: WritableSignal<number | null> = signal(null);
  readonly buyerReceiveAddress: WritableSignal<string | null> = signal(null);
  readonly selectedFundingUtxo: WritableSignal<TxnOutput | null> = signal(null);

  readonly simulationSubject = new BehaviorSubject<CreateOfferSimulationOutcome | null>(null);
  readonly simulation$ = this.simulationSubject.asObservable();

  readonly recommendedFeesSubject = new Subject<RecommendedFees>();
  readonly recommendedFees$ = this.recommendedFeesSubject.asObservable();

  readonly buyerFundingUtxosSubject = new BehaviorSubject<TxnOutput[]>([]);
  readonly buyerFundingUtxos$ = this.buyerFundingUtxosSubject.asObservable();

  readonly createOfferReturn$ = new Subject<{ base64: string; hex: string }>();

  setTargetCat = jest.fn((c: BuyOfferTargetCat | null) => this.targetCat.set(c));
  setSellerPaymentAddress = jest.fn((addr: string | null) => this.sellerPaymentAddress.set(addr));
  setPriceSats = jest.fn((p: number) => this.priceSats.set(p));
  setBuyerReceiveAddress = jest.fn((a: string | null) => this.buyerReceiveAddress.set(a));
  setFeeRate = jest.fn((r: number) => this.feeRate.set(r));
  setSelectedFundingUtxo = jest.fn((u: TxnOutput | null) => this.selectedFundingUtxo.set(u));
  createOffer = jest.fn((): Observable<{ base64: string; hex: string }> => this.createOfferReturn$.asObservable());
  reset = jest.fn();
}

class ScannerStub {
  readonly statesSubject = new BehaviorSubject<ReadonlyMap<string, UtxoScanState>>(new Map());
  readonly states$ = this.statesSubject.asObservable();
  scan = jest.fn((_: string) => of<UtxoScanState>({ kind: 'scanned-clean' }));
  autoScan = jest.fn((_: unknown[]) => undefined);
  reset = jest.fn();
  getState = jest.fn((_: string): UtxoScanState => ({ kind: 'not-scanned' }));
}

class LookupStub {
  readonly getTargetByNumberImpl = jest.fn((_: number) =>
    of({ target: target(), sellerAddress: CAT_OWNER_ORDINALS_ADDRESS }),
  );
  getTargetByNumber = (n: number) => this.getTargetByNumberImpl(n);
  getMyHoldings = jest.fn();
}

describe('MakeOffer regression — sellerPaymentAddress never derived from on-chain owner', () => {
  let orchestrator: OrchestratorStub;
  let scanner: ScannerStub;
  let walletService: WalletServiceStub;
  let lookup: LookupStub;
  let fixture: ComponentFixture<MakeOffer>;
  let component: MakeOffer;

  beforeEach(async () => {
    orchestrator = new OrchestratorStub();
    scanner = new ScannerStub();
    walletService = new WalletServiceStub();
    lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: new OrdApiServiceStub() },
        { provide: Cat21BidsService, useValue: new Cat21BidsServiceStub() },
        {
          provide: cat21Config,
          useValue: {
            ordApiUrl: 'http://test-ord/',
            cat21OrdApiUrl: 'http://test-cat21-ord/',
            slipstreamApiUrl: 'http://test-slipstream/',
          },
        },
      ],
    })
      // Skip the template — we're testing component logic, not the UI.
      // The template pulls in WalletConnect + PendingCats which each
      // subscribe to unrelated observables; not our concern here.
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(MakeOffer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does NOT call setSellerPaymentAddress with the cat owner address after a lookup', () => {
    // Arrange: buyer types a cat number; lookup returns the ordinals
    // address ord provided (= current owner).
    component.draft.update((d) => ({ ...d, catNumberInput: '42' }));

    // Act: this is the code path the buyer hits clicking "Look up cat".
    component.onLookupCatClick();

    // Assert 1 — the ONE regression that must hold. Every call to
    // setSellerPaymentAddress (past + future) must NOT carry the on-
    // chain owner address. If a future refactor re-adds
    // `orchestrator.setSellerPaymentAddress(result.sellerAddress)`
    // inside the lookup subscriber, this assertion fails.
    for (const call of orchestrator.setSellerPaymentAddress.mock.calls) {
      expect(call[0]).not.toBe(CAT_OWNER_ORDINALS_ADDRESS);
    }

    // Assert 2 — the ord lookup itself DID run (this test is not a
    // vacuous no-op because the subscriber never fired).
    expect(lookup.getTargetByNumberImpl).toHaveBeenCalledWith(42);

    // Assert 3 — setTargetCat's FINAL call receives the parsed target
    // (that part of the lookup is legitimate: the target's txid + vout
    // + scriptPubKey are cat-outpoint context, not address-type
    // context). The lookup first clears with `null` then sets the
    // resolved target.
    expect(orchestrator.setTargetCat).toHaveBeenCalledTimes(2);
    const calls = orchestrator.setTargetCat.mock.calls;
    expect(calls[0]![0]).toBeNull();
    const finalTarget = calls[1]![0] as BuyOfferTargetCat;
    expect(finalTarget.catNumber).toBe(42);
  });

  it('does propagate a URL-supplied payTo into the orchestrator (the correct source)', async () => {
    // The `payTo` URL param comes from the seller's own wallet at
    // sell-modal-open time — that's the sanctioned source for the
    // payment address. Prove this input signal path DOES reach the
    // orchestrator so the bug fix doesn't cut off the intended flow.
    fixture.componentRef.setInput('catNumber', '42');
    fixture.componentRef.setInput('payTo', WALLET_PAYMENT_ADDRESS);
    // The prefill effect reads `this.connectedWallet()`, which points at
    // `orchestrator.connectedWallet` (NOT WalletService). Set on the
    // orchestrator's signal so the effect's dependency actually fires.
    orchestrator.connectedWallet.set(wallet());
    fixture.detectChanges();
    // Effects run async — await a microtask so the prefill effect fires.
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const paymentCalls = orchestrator.setSellerPaymentAddress.mock.calls
      .map((c) => c[0]);
    expect(paymentCalls).toContain(WALLET_PAYMENT_ADDRESS);
    // And critically: NOT the ordinals address.
    expect(paymentCalls).not.toContain(WALLET_ORDINALS_ADDRESS);
    expect(paymentCalls).not.toContain(CAT_OWNER_ORDINALS_ADDRESS);
  });
});

describe('MakeOffer — catOutpoint intent-lock (stale detection)', () => {

  const URL_TXID = 'aa'.repeat(32); // outpoint the seller's link was pinned to
  const OTHER_TXID = 'bb'.repeat(32); // cat's current outpoint (differs → stale)

  it('URL-supplied catTxid + catVout parse via linkedOutpoint()', async () => {
    const orchestrator = new OrchestratorStub();
    const scanner = new ScannerStub();
    const walletService = new WalletServiceStub();
    const lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: new OrdApiServiceStub() },
        { provide: Cat21BidsService, useValue: new Cat21BidsServiceStub() },
        {
          provide: cat21Config,
          useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' },
        },
      ],
    })
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(MakeOffer);
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    fixture.detectChanges();
    expect(fixture.componentInstance.linkedOutpoint()).toEqual({ txid: URL_TXID, vout: 0 });
  });

  it('staleOffer=true when URL outpoint ≠ orchestrator targetCat outpoint (cat moved)', async () => {
    const orchestrator = new OrchestratorStub();
    const scanner = new ScannerStub();
    const walletService = new WalletServiceStub();
    const lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: new OrdApiServiceStub() },
        { provide: Cat21BidsService, useValue: new Cat21BidsServiceStub() },
        {
          provide: cat21Config,
          useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' },
        },
      ],
    })
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(MakeOffer);
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    // Simulate the on-chain lookup completing with a DIFFERENT outpoint
    // (cat has moved since the URL was minted).
    orchestrator.targetCat.set(target({ txid: OTHER_TXID, vout: 0 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.staleOffer()).toBe(true);
    expect(fixture.componentInstance.canCreateOffer()).toBe(false);
  });

  it('staleOffer=false when URL outpoint == orchestrator targetCat outpoint (fresh link)', async () => {
    const orchestrator = new OrchestratorStub();
    const scanner = new ScannerStub();
    const walletService = new WalletServiceStub();
    const lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: new OrdApiServiceStub() },
        { provide: Cat21BidsService, useValue: new Cat21BidsServiceStub() },
        {
          provide: cat21Config,
          useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' },
        },
      ],
    })
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(MakeOffer);
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    orchestrator.targetCat.set(target({ txid: URL_TXID, vout: 0 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.staleOffer()).toBe(false);
  });

  it('staleOffer=false when URL has no intent-lock (legacy link — no stale check)', async () => {
    const orchestrator = new OrchestratorStub();
    const scanner = new ScannerStub();
    const walletService = new WalletServiceStub();
    const lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: new OrdApiServiceStub() },
        { provide: Cat21BidsService, useValue: new Cat21BidsServiceStub() },
        {
          provide: cat21Config,
          useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' },
        },
      ],
    })
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(MakeOffer);
    orchestrator.targetCat.set(target({ txid: OTHER_TXID, vout: 0 }));
    fixture.detectChanges();

    expect(fixture.componentInstance.linkedOutpoint()).toBeNull();
    expect(fixture.componentInstance.staleOffer()).toBe(false);
  });

  it('staleOffer=false while the lookup has not resolved (do NOT block the form before truth is known)', async () => {
    const orchestrator = new OrchestratorStub();
    const scanner = new ScannerStub();
    const walletService = new WalletServiceStub();
    const lookup = new LookupStub();

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: new OrdApiServiceStub() },
        { provide: Cat21BidsService, useValue: new Cat21BidsServiceStub() },
        {
          provide: cat21Config,
          useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' },
        },
      ],
    })
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(MakeOffer);
    fixture.componentRef.setInput('catTxid', URL_TXID);
    fixture.componentRef.setInput('catVout', '0');
    // orchestrator.targetCat stays null (lookup in flight).
    fixture.detectChanges();

    expect(fixture.componentInstance.staleOffer()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('MakeOffer — Post to Bazaar (X.5)', () => {

  const CAT_TXID = 'aa'.repeat(32);

  async function setupBazaar(opts: {
    withOffer?: boolean;
    catsAtOutput?: (txid: string, vout: number) => Observable<number[]>;
    onPost?: (args: PostBidArgs) => Observable<PersistedCat21Bid>;
  } = {}) {
    const orchestrator = new OrchestratorStub();
    const scanner = new ScannerStub();
    const walletService = new WalletServiceStub();
    const lookup = new LookupStub();
    const ordApi = new OrdApiServiceStub();
    const bidsService = new Cat21BidsServiceStub();

    if (opts.catsAtOutput) ordApi.setCatsAtOutput(opts.catsAtOutput);
    if (opts.onPost) bidsService.postBid = jest.fn(opts.onPost) as never;

    await TestBed.configureTestingModule({
      imports: [MakeOffer],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: Cat21CreateOfferOrchestrator, useValue: orchestrator },
        { provide: UtxoContentScanner, useValue: scanner },
        { provide: WalletService, useValue: walletService },
        { provide: CatUtxoLookupService, useValue: lookup },
        { provide: OrdApiService, useValue: ordApi },
        { provide: Cat21BidsService, useValue: bidsService },
        { provide: cat21Config, useValue: { ordApiUrl: 't', cat21OrdApiUrl: 't', slipstreamApiUrl: 't' } },
      ],
    })
      .overrideComponent(MakeOffer, { set: { template: '', imports: [] } })
      .compileComponents();

    const fixture = TestBed.createComponent(MakeOffer);
    const component = fixture.componentInstance;
    // Populate BOTH the walletService subject AND the orchestrator's
    // connectedWallet signal — MakeOffer's `this.connectedWallet` reads
    // the orchestrator's signal, not the walletService's subject.
    walletService.connectedWalletSubject.next(wallet());
    orchestrator.connectedWallet.set(wallet());
    fixture.detectChanges();

    if (opts.withOffer !== false) {
      // Simulate a completed offer flow: seller-payment address set,
      // price set, buyer-receive address set, artifact populated,
      // target locked in.
      orchestrator.setTargetCat(target({ txid: CAT_TXID, vout: 0 }));
      orchestrator.setSellerPaymentAddress('bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm');
      orchestrator.setPriceSats(21_000);
      orchestrator.setBuyerReceiveAddress(WALLET_ORDINALS_ADDRESS);
      orchestrator.offerArtifact.set({ base64: 'cHNidP8BAP0Y', hex: 'aabb' });
    }

    return { fixture, component, orchestrator, ordApi, bidsService };
  }

  it('canPostToBazaar() is false without an offer artifact', async () => {
    const { component } = await setupBazaar({ withOffer: false });
    expect(component.canPostToBazaar()).toBe(false);
  });

  it('canPostToBazaar() is true once the offer artifact + target are set', async () => {
    const { component } = await setupBazaar({ catsAtOutput: () => of([42]) });
    expect(component.canPostToBazaar()).toBe(true);
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
        bidSats: 21_000,
        buyerOrdinalsAddress: WALLET_ORDINALS_ADDRESS,
        buyerPaymentAddress: WALLET_PAYMENT_ADDRESS,
        sellerPaymentAddress: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
        psbtBase64: 'cHNidP8BAP0Y',
        createdAt: '2026-07-22T10:00:00Z',
      }),
    });
    const catsSpy = jest.spyOn(ordApi, 'getCatsAtOutput');

    component.onPostToBazaarClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(catsSpy).toHaveBeenCalledWith(CAT_TXID, 0);
    expect(bidsService.postBid).toHaveBeenCalledTimes(1);
    expect((bidsService.postBid as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      catTxid: CAT_TXID,
      catVout: 0,
      cats: [42],
      headlineCatNumber: 42,
      bidSats: 21_000,
      buyerOrdinalsAddress: WALLET_ORDINALS_ADDRESS,
      buyerPaymentAddress: WALLET_PAYMENT_ADDRESS,
      sellerPaymentAddress: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
      psbtBase64: 'cHNidP8BAP0Y',
    });
    expect(component.bidPublishState()).toBe('success');
    expect(component.bidPublishedRow()?.id).toBe('uuid-x');
  });

  it('surfaces cats-bundle-drift when the target catNumber is not in the fetched bundle', async () => {
    // ord reports [7, 100] — cat #42 (target headline) has moved off
    // this UTXO. postBid must NOT be called; UI shows drift error.
    const { component, bidsService } = await setupBazaar({
      catsAtOutput: () => of([7, 100]),
    });

    component.onPostToBazaarClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(bidsService.postBid).not.toHaveBeenCalled();
    expect(component.bidPublishState()).toBe('error');
    expect(component.bidPublishError()?.code).toBe('cats-bundle-drift');
  });

  it('surfaces backend errors from postBid (e.g. cats-bundle-drift server-side) via bidPublishError', async () => {
    const { component } = await setupBazaar({
      catsAtOutput: () => of([42]),
      onPost: () => throwError(() => ({ code: 'cats-bundle-drift', detail: 'live [42, 99]' } as never)),
    });

    component.onPostToBazaarClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(component.bidPublishState()).toBe('error');
    expect(component.bidPublishError()?.code).toBe('cats-bundle-drift');
  });

  it('surfaces ord fetch failures via ord-lookup-failed', async () => {
    const { component, bidsService } = await setupBazaar({
      catsAtOutput: () => throwError(() => new Error('boom')),
    });

    component.onPostToBazaarClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();

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
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.bidPublishState()).toBe('success');

    component.onResetClick();
    expect(component.bidPublishState()).toBe('idle');
    expect(component.bidPublishError()).toBeNull();
    expect(component.bidPublishedRow()).toBeNull();
  });
});
