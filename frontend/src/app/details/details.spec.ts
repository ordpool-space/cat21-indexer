import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, Observable, of, throwError } from 'rxjs';

import { BuyOfferTargetCat, WalletInfo, WalletService } from 'ordpool-sdk';

import { Details } from './details';
import { ApiService } from '../shared/cat21-api';
import { Cat21BidsService, PersistedCat21Bid } from '../shared/cat21-bids.service';
import { Cat21ListingService } from '../shared/cat21-listing.service';
import { CatUtxoLookupService } from '../shared/cat-utxo-lookup.service';
import { OrdApiService } from '../shared/ord-api.service';
import { makeWallet, WalletServiceStub } from '../testing/wallet.fixtures';

// ---------------------------------------------------------------------------
// Split payment vs ordinals addresses ARE THE POINT of this spec. We're
// pinning the sell modal's ORIGIN of the payTo permalink parameter —
// wallet.paymentAddress, never wallet.ordinalsAddress and never the ord
// owner lookup. This is the source-side guarantee to the
// make-offer/accept-offer fixes.
// ---------------------------------------------------------------------------
const WALLET_PAYMENT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';
const WALLET_ORDINALS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

const wallet = makeWallet;

class ApiServiceStub {
  catsControllerGetCatByNumber = jest.fn((_: number) => of({} as unknown));
  catsControllerGetStatus = jest.fn(() => of({ lastSyncedCatNumber: 100_000 } as unknown));
}

class OrdApiServiceStub {
  private ownerImpl: (n: number) => Observable<string | null> = () => EMPTY;
  private catsAtOutputImpl: (txid: string, vout: number) => Observable<number[]> = () => of([]);
  setOwner(fn: (n: number) => Observable<string | null>) {
    this.ownerImpl = fn;
  }
  setCatsAtOutput(fn: (txid: string, vout: number) => Observable<number[]>) {
    this.catsAtOutputImpl = fn;
  }
  getCurrentOwner = (n: number) => this.ownerImpl(n);
  getCatsAtOutput = (txid: string, vout: number) => this.catsAtOutputImpl(txid, vout);
}

class BidsServiceStub {
  private bidsImpl: (txid: string, vout: number) => Observable<PersistedCat21Bid[]> = () => of([]);
  setBids(fn: (txid: string, vout: number) => Observable<PersistedCat21Bid[]>) {
    this.bidsImpl = fn;
  }
  getBidsForOutpoint = (txid: string, vout: number) => this.bidsImpl(txid, vout);
  deleteBid = jest.fn();
}

// Minimal target shape — details.ts only reads txid + vout off `.target`.
const targetAt = (txid: string, vout: number): { target: BuyOfferTargetCat; sellerAddress: string } => ({
  target: { catNumber: 42, txid, vout, value: 546, scriptPubKey: new Uint8Array([0x51, 0x20]) },
  sellerAddress: 'bc1p-someone',
});

class LookupStub {
  private targetImpl: (n: number) => Observable<{ target: BuyOfferTargetCat; sellerAddress: string } | null> = () => EMPTY;
  setTarget(fn: (n: number) => Observable<{ target: BuyOfferTargetCat; sellerAddress: string } | null>) {
    this.targetImpl = fn;
  }
  getTargetByNumber = (n: number) => this.targetImpl(n);
  getMyHoldings = jest.fn();
}

class ListingServiceStub {
  publishListing = jest.fn();
  getListingForCat = jest.fn((_: number) => of(null as unknown));
}

async function setup(opts: {
  catNumber?: number;
  payTo?: string;
  ask?: string;
  catTxid?: string;
  catVout?: string;
  owner?: (n: number) => Observable<string | null>;
  currentTarget?: (n: number) => Observable<{ target: BuyOfferTargetCat; sellerAddress: string } | null>;
  bids?: (txid: string, vout: number) => Observable<PersistedCat21Bid[]>;
  catsAtOutput?: (txid: string, vout: number) => Observable<number[]>;
} = {}) {
  const walletService = new WalletServiceStub();
  const api = new ApiServiceStub();
  const ordApi = new OrdApiServiceStub();
  const lookup = new LookupStub();
  const listingService = new ListingServiceStub();
  const bidsService = new BidsServiceStub();
  if (opts.owner) ordApi.setOwner(opts.owner);
  if (opts.currentTarget) lookup.setTarget(opts.currentTarget);
  if (opts.bids) bidsService.setBids(opts.bids);
  if (opts.catsAtOutput) ordApi.setCatsAtOutput(opts.catsAtOutput);

  await TestBed.configureTestingModule({
    imports: [Details],
    providers: [
      provideHttpClient(),
      provideRouter([]),
      { provide: WalletService, useValue: walletService },
      { provide: ApiService, useValue: api },
      { provide: OrdApiService, useValue: ordApi },
      { provide: CatUtxoLookupService, useValue: lookup },
      { provide: Cat21ListingService, useValue: listingService },
      { provide: Cat21BidsService, useValue: bidsService },
    ],
  })
    .overrideComponent(Details, { set: { template: '', imports: [] } })
    .compileComponents();

  const fixture = TestBed.createComponent(Details);
  fixture.componentRef.setInput('catNumber', opts.catNumber ?? 42);
  if (opts.payTo !== undefined) fixture.componentRef.setInput('payTo', opts.payTo);
  if (opts.ask !== undefined) fixture.componentRef.setInput('ask', opts.ask);
  if (opts.catTxid !== undefined) fixture.componentRef.setInput('catTxid', opts.catTxid);
  if (opts.catVout !== undefined) fixture.componentRef.setInput('catVout', opts.catVout);
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, walletService, ordApi, api, lookup, listingService, bidsService };
}

describe('Details — sell permalink (`generatedPermalink`)', () => {

  it('null when askInput is empty', async () => {
    const { component } = await setup();
    expect(component.generatedPermalink()).toBeNull();
  });

  it('null when askInput is not a positive integer', async () => {
    const { component } = await setup();
    component.onAskInputChange('not-a-number');
    expect(component.generatedPermalink()).toBeNull();
    component.onAskInputChange('0');
    expect(component.generatedPermalink()).toBeNull();
    component.onAskInputChange('-1');
    expect(component.generatedPermalink()).toBeNull();
  });

  it('with a wallet connected, includes payTo=wallet.paymentAddress (the fix) AND ask=<n>', async () => {
    const { component, walletService } = await setup();
    walletService.connectedWalletSubject.next(wallet());
    component.onAskInputChange('21000');

    const url = component.generatedPermalink();
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe('/cat/42');
    expect(parsed.searchParams.get('ask')).toBe('21000');
    // CRITICAL: payTo is the wallet's PAYMENT address, not the ordinals one.
    expect(parsed.searchParams.get('payTo')).toBe(WALLET_PAYMENT);
    // Explicit anti-regression: the ordinals address must never appear.
    expect(url).not.toContain(WALLET_ORDINALS);
  });

  it('without a wallet, falls back to ask-only (no payTo) so buyer prompts seller instead of silent misroute', async () => {
    const { component } = await setup();
    component.onAskInputChange('21000');
    const url = component.generatedPermalink();
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('ask')).toBe('21000');
    expect(parsed.searchParams.get('payTo')).toBeNull();
  });

  it('wallet swap updates payTo in the generated link', async () => {
    const OLD_PAY = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';
    const NEW_PAY = 'bc1qgc0m7cd9s3z9wmpc9djcygxzr9s5s9rlaqlfr9';
    const { component, walletService } = await setup();
    walletService.connectedWalletSubject.next(wallet({ paymentAddress: OLD_PAY }));
    component.onAskInputChange('21000');
    expect(new URL(component.generatedPermalink()!).searchParams.get('payTo')).toBe(OLD_PAY);
    walletService.connectedWalletSubject.next(wallet({ paymentAddress: NEW_PAY }));
    expect(new URL(component.generatedPermalink()!).searchParams.get('payTo')).toBe(NEW_PAY);
  });
});

describe('Details — buyQueryParams (forward payTo from URL to make-offer)', () => {

  it('URL carries payTo → buyQueryParams forwards sellerPaymentAddress', async () => {
    const { component } = await setup({ catNumber: 7, ask: '21000', payTo: WALLET_PAYMENT });
    const params = component.buyQueryParams();
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBe('21000');
    expect(params['payTo']).toBe(WALLET_PAYMENT);
  });

  it('URL lacks payTo → buyQueryParams omits it (legacy links still work; buyer types it)', async () => {
    const { component } = await setup({ catNumber: 7, ask: '21000' });
    const params = component.buyQueryParams();
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBe('21000');
    expect(params['payTo']).toBeUndefined();
  });

  it('URL lacks ask → buyQueryParams omits askPrice too', async () => {
    const { component } = await setup({ catNumber: 7 });
    const params = component.buyQueryParams();
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBeUndefined();
    expect(params['payTo']).toBeUndefined();
  });
});

describe('Details — button state computeds', () => {

  it('all three buttons downgrade to "connect" when no wallet + owner resolved', async () => {
    const { fixture, component } = await setup({
      owner: () => of('bc1p-someone-else'),
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('connect');
    expect(component.buyButtonState()).toBe('connect');
    expect(component.sendButtonState()).toBe('connect');
  });

  it('owner === wallet.ordinalsAddress → sell/send enabled, buy owns-it', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => of(WALLET_ORDINALS),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('enabled');
    expect(component.sendButtonState()).toBe('enabled');
    expect(component.buyButtonState()).toBe('owns-it');
  });

  it('owner !== wallet.ordinalsAddress → sell/send not-owner, buy enabled', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => of('bc1p-someone-else'),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('not-owner');
    expect(component.sendButtonState()).toBe('not-owner');
    expect(component.buyButtonState()).toBe('enabled');
  });

  it('owner = null (free / unspendable) → all three buttons are "free"', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => of(null),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('free');
    expect(component.buyButtonState()).toBe('free');
    expect(component.sendButtonState()).toBe('free');
    expect(component.isFree()).toBe(true);
  });

  it('ord lookup errors → all three buttons are "unknown" (never guess)', async () => {
    const { fixture, component, walletService } = await setup({
      owner: () => throwError(() => new Error('ord down')),
    });
    walletService.connectedWalletSubject.next(wallet());
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(component.sellButtonState()).toBe('unknown');
    expect(component.buyButtonState()).toBe('unknown');
    expect(component.sendButtonState()).toBe('unknown');
    expect(component.ownerLookupUnknown()).toBe(true);
  });
});

describe('Details — askSats parsing', () => {
  it('unspecified → null', async () => {
    const { component } = await setup();
    expect(component.askSats()).toBeNull();
  });

  it('positive integer → number', async () => {
    const { component } = await setup({ ask: '21000' });
    expect(component.askSats()).toBe(21_000);
  });

  it('zero → null', async () => {
    const { component } = await setup({ ask: '0' });
    expect(component.askSats()).toBeNull();
  });

  it('garbage → null', async () => {
    const { component } = await setup({ ask: 'nope' });
    expect(component.askSats()).toBeNull();
  });
});

describe('Details — catOutpoint intent-lock (stale detection)', () => {

  const CURRENT_TXID = 'aa'.repeat(32); // matches the URL-supplied catTxid
  const OTHER_TXID = 'bb'.repeat(32); // different outpoint → stale

  it('generatedPermalink includes catTxid + catVout from the CURRENT lookup at modal-open time', async () => {
    const { component, walletService } = await setup({
      currentTarget: () => of(targetAt(CURRENT_TXID, 0)),
    });
    walletService.connectedWalletSubject.next(wallet());
    // Give the resource one tick.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    component.onAskInputChange('21000');
    const url = component.generatedPermalink();
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('catTxid')).toBe(CURRENT_TXID);
    expect(parsed.searchParams.get('catVout')).toBe('0');
    // The intent-lock IS the whole point — anti-regression that the
    // permalink still carries payTo alongside.
    expect(parsed.searchParams.get('payTo')).toBe(WALLET_PAYMENT);
  });

  it('generatedPermalink OMITS catTxid when the current-target lookup has not resolved', async () => {
    const { component, walletService } = await setup({
      currentTarget: () => EMPTY, // never emits
    });
    walletService.connectedWalletSubject.next(wallet());
    component.onAskInputChange('21000');
    const url = component.generatedPermalink();
    expect(url).not.toBeNull();
    expect(new URL(url!).searchParams.get('catTxid')).toBeNull();
  });

  it('URL-supplied catTxid parses via linkedOutpoint()', async () => {
    const { component } = await setup({ catTxid: CURRENT_TXID, catVout: '0' });
    expect(component.linkedOutpoint()).toEqual({ txid: CURRENT_TXID, vout: 0 });
  });

  it('URL missing catVout → linkedOutpoint is null (partial intent-lock is not an intent-lock)', async () => {
    const { component } = await setup({ catTxid: CURRENT_TXID });
    expect(component.linkedOutpoint()).toBeNull();
  });

  it('garbage catTxid → linkedOutpoint is null', async () => {
    const { component } = await setup({ catTxid: 'not-hex', catVout: '0' });
    expect(component.linkedOutpoint()).toBeNull();
  });

  it('isStaleOffer is TRUE when URL outpoint ≠ current outpoint (cat moved)', async () => {
    const { component } = await setup({
      catTxid: CURRENT_TXID,
      catVout: '0',
      currentTarget: () => of(targetAt(OTHER_TXID, 0)),
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.isStaleOffer()).toBe(true);
  });

  it('isStaleOffer is FALSE when URL outpoint == current outpoint (fresh link)', async () => {
    const { component } = await setup({
      catTxid: CURRENT_TXID,
      catVout: '0',
      currentTarget: () => of(targetAt(CURRENT_TXID, 0)),
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.isStaleOffer()).toBe(false);
  });

  it('isStaleOffer is FALSE when URL has no intent-lock (legacy link, no stale check)', async () => {
    const { component } = await setup({
      currentTarget: () => of(targetAt(CURRENT_TXID, 0)),
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.isStaleOffer()).toBe(false);
  });

  it('isStaleOffer stays FALSE while the current-target lookup is loading (do NOT misfire before truth is known)', async () => {
    const { component } = await setup({
      catTxid: CURRENT_TXID,
      catVout: '0',
      currentTarget: () => EMPTY, // never emits
    });
    expect(component.isStaleOffer()).toBe(false);
  });

  it('Buy button downgrades to "stale" when the offer is stale', async () => {
    const { component, walletService } = await setup({
      catTxid: CURRENT_TXID,
      catVout: '0',
      currentTarget: () => of(targetAt(OTHER_TXID, 0)),
      owner: () => of('bc1p-someone-else'),
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.buyButtonState()).toBe('stale');
  });

  it('Sell + Send buttons IGNORE stale — they are the current owner\'s actions', async () => {
    const { component, walletService } = await setup({
      catTxid: CURRENT_TXID,
      catVout: '0',
      currentTarget: () => of(targetAt(OTHER_TXID, 0)),
      owner: () => of(WALLET_ORDINALS), // wallet IS the current owner
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    // Sell/Send read live ownership; a stale URL doesn't stop the
    // owner from acting on their own cat.
    expect(component.sellButtonState()).toBe('enabled');
    expect(component.sendButtonState()).toBe('enabled');
  });

  it('buyQueryParams forwards the URL catOutpoint to make-offer (intent-lock survives the hop)', async () => {
    const { component } = await setup({
      catTxid: CURRENT_TXID,
      catVout: '0',
      ask: '21000',
      payTo: WALLET_PAYMENT,
    });
    const params = component.buyQueryParams();
    expect(params['catTxid']).toBe(CURRENT_TXID);
    expect(params['catVout']).toBe('0');
    expect(params['payTo']).toBe(WALLET_PAYMENT);
    expect(params['askPrice']).toBe('21000');
  });

  it('buyQueryParams omits catOutpoint when URL didn\'t bring one (legacy)', async () => {
    const { component } = await setup({ ask: '21000' });
    const params = component.buyQueryParams();
    expect(params['catTxid']).toBeUndefined();
    expect(params['catVout']).toBeUndefined();
  });
});


describe('Details — orderbook publish flow (sell modal checkbox → sign → POST)', () => {

  const TXID = 'aa'.repeat(32);

  it('checkbox defaults to CHECKED — publishing is the default seller intent', async () => {
    const { component } = await setup();
    expect(component.publishToOrderbook()).toBe(true);
  });

  it('Copy click with checkbox ON invokes listingService.publishListing with the ask + current outpoint + cats bundle', async () => {
    const { component, walletService, listingService } = await setup({
      currentTarget: () => of(targetAt(TXID, 0)),
      catsAtOutput: () => of([42]),
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();

    component.onAskInputChange('21000');
    listingService.publishListing.mockReturnValue(of({ id: 'x' } as never));

    component.onCopyPermalinkClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(listingService.publishListing).toHaveBeenCalledTimes(1);
    expect(listingService.publishListing.mock.calls[0]?.[0]).toEqual({
      catNumber: 42,
      cats: [42],
      askSats: 21_000,
      catTxid: TXID,
      catVout: 0,
    });
  });

  it('Copy click with checkbox OFF does NOT invoke publishListing', async () => {
    const { component, walletService, listingService } = await setup({
      currentTarget: () => of(targetAt(TXID, 0)),
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();

    component.onAskInputChange('21000');
    component.onPublishToOrderbookToggle(false);
    component.onCopyPermalinkClick();

    expect(listingService.publishListing).not.toHaveBeenCalled();
  });

  it('publishListing success → orderbookState becomes "success", no error', async () => {
    const { component, walletService, listingService } = await setup({
      currentTarget: () => of(targetAt(TXID, 0)),
      catsAtOutput: () => of([42]),
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    component.onAskInputChange('21000');
    listingService.publishListing.mockReturnValue(of({ id: 'x' } as never));

    component.onCopyPermalinkClick();
    // Sync subscribe — of() is synchronous through the ord + service chain.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.orderbookState()).toBe('success');
    expect(component.orderbookError()).toBeNull();
  });

  it('publishListing error → orderbookState becomes "error", orderbookError carries {code, detail}', async () => {
    const { component, walletService, listingService } = await setup({
      currentTarget: () => of(targetAt(TXID, 0)),
      catsAtOutput: () => of([42]),
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    component.onAskInputChange('21000');
    listingService.publishListing.mockReturnValue(
      throwError(() => ({ code: 'not-current-owner', detail: 'not owner' })),
    );

    component.onCopyPermalinkClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.orderbookState()).toBe('error');
    expect(component.orderbookError()).toEqual({ code: 'not-current-owner', detail: 'not owner' });
  });

  it('publishListing bails when current outpoint has not resolved yet — state=error with a helpful message', async () => {
    const { component, walletService, listingService } = await setup({
      currentTarget: () => EMPTY, // never emits
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    component.onAskInputChange('21000');

    component.onCopyPermalinkClick();
    // listingService NEVER called — we short-circuit before signing.
    expect(listingService.publishListing).not.toHaveBeenCalled();
    expect(component.orderbookState()).toBe('error');
    expect(component.orderbookError()?.detail).toContain('outpoint not yet resolved');
  });

  it('unchecking the checkbox clears prior error state', async () => {
    const { component, walletService, listingService } = await setup({
      currentTarget: () => of(targetAt(TXID, 0)),
    });
    walletService.connectedWalletSubject.next(wallet());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    component.onAskInputChange('21000');
    listingService.publishListing.mockReturnValue(
      throwError(() => ({ code: 'wallet-signature-failed', detail: 'rejected' })),
    );
    component.onCopyPermalinkClick();
    expect(component.orderbookState()).toBe('error');

    component.onPublishToOrderbookToggle(false);
    expect(component.orderbookState()).toBe('idle');
    expect(component.orderbookError()).toBeNull();
  });
});


describe('Details — active orderbook listing badge', () => {

  it('activeListing() is null when getListingForCat returns null', async () => {
    const { component, listingService } = await setup();
    listingService.getListingForCat.mockReturnValue(of(null));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.activeListing()).toBeNull();
  });

  // Install the listing BEFORE fixture creation so the resource fires
  // once — with the real DTO — instead of null-then-reload dance.
  const setupWithListing = async (catNumber: number) => {
    const listing = {
      id: 'x', catNumber, askSats: 21_000, payTo: WALLET_PAYMENT,
      catTxid: 'aa'.repeat(32), catVout: 0, ordinalsAddress: WALLET_ORDINALS,
      signedAt: 1_700_000_000, signature: 'sig', createdAt: '2026-07-19T10:00:00Z',
    };
    const s = await setup({ catNumber });
    s.listingService.getListingForCat.mockReturnValue(of(listing));
    s.component.listingResource.reload();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    s.fixture.detectChanges();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return s;
  };

  it('activeListing() carries the DTO when the backend has a listing for this cat', async () => {
    const { component } = await setupWithListing(42);
    expect(component.activeListing()?.catNumber).toBe(42);
    expect(component.activeListing()?.askSats).toBe(21_000);
  });

  it('listingBuyQueryParams forwards catNumber + askSats + payTo + outpoint (intent-lock survives to make-offer)', async () => {
    const { component } = await setupWithListing(42);
    const params = component.listingBuyQueryParams();
    expect(params['catNumber']).toBe('42');
    expect(params['askPrice']).toBe('21000');
    expect(params['payTo']).toBe(WALLET_PAYMENT);
    expect(params['catTxid']).toBe('aa'.repeat(32));
    expect(params['catVout']).toBe('0');
  });

  it('listingBuyQueryParams returns empty object when no active listing', async () => {
    const { component } = await setup();
    expect(component.listingBuyQueryParams()).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('Details — active bids panel (X.4)', () => {

  const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';

  const bidRow = (over: Partial<PersistedCat21Bid> = {}): PersistedCat21Bid => ({
    id: 'uuid-1',
    network: 'mainnet',
    catTxid: REAL_TXID,
    catVout: 0,
    cats: [42],
    headlineCatNumber: 42,
    bidSats: 21_000,
    buyerOrdinalsAddress: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    buyerPaymentAddress: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx',
    sellerPaymentAddress: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
    psbtBase64: 'cHNidP8B...',
    createdAt: '2026-07-22T10:00:00.000Z',
    ...over,
  });

  const setupWithBids = async (bids: PersistedCat21Bid[]) => {
    const s = await setup({
      catNumber: 42,
      currentTarget: () => of(targetAt(REAL_TXID, 0)),
      bids: () => of(bids),
    });
    // rxResourceFixed values update asynchronously — wait a few
    // microtask ticks + one detectChanges cycle for the resource
    // params observer to pick up the resolved currentTarget.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    s.fixture.detectChanges();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return s;
  };

  it('hasBids() is false + activeBids() empty when the outpoint has no bids', async () => {
    const { component } = await setupWithBids([]);
    expect(component.hasBids()).toBe(false);
    expect(component.activeBids()).toEqual([]);
  });

  it('activeBids() reflects the backend response ordering', async () => {
    // Backend returns DESC by price; we trust that ordering.
    const { component } = await setupWithBids([
      bidRow({ id: 'a', bidSats: 30_000, buyerOrdinalsAddress: 'bc1p-a' }),
      bidRow({ id: 'b', bidSats: 21_000, buyerOrdinalsAddress: 'bc1p-b' }),
      bidRow({ id: 'c', bidSats: 15_000, buyerOrdinalsAddress: 'bc1p-c' }),
    ]);
    expect(component.hasBids()).toBe(true);
    expect(component.activeBids().map((b) => b.bidSats)).toEqual([30_000, 21_000, 15_000]);
  });

  it('highestBidSats() surfaces max(bidSats) — the FOMO number', async () => {
    const { component } = await setupWithBids([
      bidRow({ id: 'a', bidSats: 30_000, buyerOrdinalsAddress: 'bc1p-a' }),
      bidRow({ id: 'b', bidSats: 100_000, buyerOrdinalsAddress: 'bc1p-b' }),
      bidRow({ id: 'c', bidSats: 15_000, buyerOrdinalsAddress: 'bc1p-c' }),
    ]);
    expect(component.highestBidSats()).toBe(100_000);
  });

  it('highestBidSats() is null when no bids', async () => {
    const { component } = await setupWithBids([]);
    expect(component.highestBidSats()).toBeNull();
  });

  it('acceptBidQueryParams threads the PSBT + outpoint into the accept-offer link (X.6)', async () => {
    const bid: PersistedCat21Bid = {
      id: 'uuid-x',
      network: 'mainnet',
      catTxid: REAL_TXID,
      catVout: 0,
      cats: [42],
      headlineCatNumber: 42,
      bidSats: 21_000,
      buyerOrdinalsAddress: 'bc1p-buyer',
      buyerPaymentAddress: 'bc1q-pay',
      sellerPaymentAddress: 'bc1q-seller-pay',
      psbtBase64: 'cHNidP8BAP0Y',
      createdAt: '2026-07-22T10:00:00Z',
    };
    const { component } = await setupWithBids([bid]);
    const params = component.acceptBidQueryParams(bid);
    // buildAcceptOfferQueryParams should emit the base64 PSBT + catTxid + catVout
    // as separate string params — the exact key names live in the SDK but the
    // values must survive.
    const values = Object.values(params);
    expect(values).toContain('cHNidP8BAP0Y');
    expect(values).toContain(REAL_TXID);
    expect(values).toContain('0');
  });
});

// ---------------------------------------------------------------------------

describe('Details — publishListing threads the cats bundle from ord (v3 flow)', () => {

  const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';

  it('fetches getCatsAtOutput + calls publishListing with the cats array', async () => {
    const { component, listingService, ordApi } = await setup({
      catNumber: 42,
      currentTarget: () => of(targetAt(REAL_TXID, 0)),
      catsAtOutput: () => of([0, 42, 100]),
    });
    // Wait for currentTargetResource to resolve.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const spy = jest.spyOn(listingService, 'publishListing').mockReturnValue(of({} as never));
    const catsSpy = jest.spyOn(ordApi, 'getCatsAtOutput');

    component.onAskInputChange('21000');
    component.publishToOrderbook.set(true);
    component.onCopyPermalinkClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(catsSpy).toHaveBeenCalledWith(REAL_TXID, 0);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        catNumber: 42,
        cats: [0, 42, 100],
        catTxid: REAL_TXID,
        catVout: 0,
        askSats: 21_000,
      }),
    );
  });

  it('surfaces cats-bundle-drift when the current cat isn\'t in the fetched bundle', async () => {
    // ord reports cats [7, 100] — cat #42 (the headline) is no longer
    // on this UTXO. Surface as `cats-bundle-drift` (same code the
    // backend uses) and DO NOT call publishListing.
    const { component, listingService } = await setup({
      catNumber: 42,
      currentTarget: () => of(targetAt(REAL_TXID, 0)),
      catsAtOutput: () => of([7, 100]),
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const spy = jest.spyOn(listingService, 'publishListing');

    component.onAskInputChange('21000');
    component.publishToOrderbook.set(true);
    component.onCopyPermalinkClick();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(spy).not.toHaveBeenCalled();
    expect(component.orderbookState()).toBe('error');
    expect(component.orderbookError()?.code).toBe('cats-bundle-drift');
  });
});
