import { describe, expect, it, jest } from '@jest/globals';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';

import {
  Cat21Listing,
  KnownOrdinalWalletType,
  Network,
  WalletInfo,
  WalletService,
} from 'ordpool-sdk';

import { Cat21ListingService, CreateListingError, PersistedCat21Listing } from './cat21-listing.service';
import { Cat21SessionService } from './cat21-session.service';

const WALLET_PAYMENT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';
const WALLET_ORDINALS = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

const wallet: WalletInfo = {
  type: KnownOrdinalWalletType.cat21wallet,
  ordinalsAddress: WALLET_ORDINALS,
  paymentAddress: WALLET_PAYMENT,
  paymentPublicKey: '02' + 'aa'.repeat(32),
  ordinalsPublicKey: '02' + 'bb'.repeat(32),
  signingSupported: true,
};

class WalletServiceStub {
  readonly connectedWallet$ = new BehaviorSubject<WalletInfo | null>(null);
  readonly network = Network.Mainnet;
}

class Cat21SessionServiceStub {
  headersFor = jest.fn((address: string) =>
    of({
      'X-Cat21-Session-Address': address,
      'X-Cat21-Session-Valid-Until': '2099-01-01T00:00:00.000Z',
      'X-Cat21-Session-Signature': 'sig-base64',
    }),
  );
  clearFor = jest.fn();
}

async function setup(): Promise<{
  service: Cat21ListingService;
  walletService: WalletServiceStub;
  sessionService: Cat21SessionServiceStub;
  httpMock: HttpTestingController;
}> {
  const walletService = new WalletServiceStub();
  const sessionService = new Cat21SessionServiceStub();
  await TestBed.configureTestingModule({
    providers: [
      Cat21ListingService,
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: WalletService, useValue: walletService },
      { provide: Cat21SessionService, useValue: sessionService },
    ],
  }).compileComponents();
  return {
    service: TestBed.inject(Cat21ListingService),
    walletService,
    sessionService,
    httpMock: TestBed.inject(HttpTestingController),
  };
}

const publishArgs = () => ({
  catNumber: 42,
  cats: [42],
  askSats: 21_000,
  catTxid: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df',
  catVout: 0,
});

describe('Cat21ListingService.publishListing', () => {

  it('errors wallet-not-connected when no wallet is present', async () => {
    const { service } = await setup();
    let caught: CreateListingError | null = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect((caught as CreateListingError | null)?.code).toBe('wallet-not-connected');
  });

  it('POSTs the listing DTO with session-token headers', async () => {
    const { service, walletService, sessionService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    const persisted: PersistedCat21Listing = {
      id: 'uuid-1',
      catNumber: 42,
      cats: [42],
      network: 'mainnet',
      askSats: 21_000,
      payTo: WALLET_PAYMENT,
      catTxid: publishArgs().catTxid,
      catVout: 0,
      ordinalsAddress: WALLET_ORDINALS,
      signedAt: 0,
      signature: '',
      createdAt: '2026-07-25T12:00:00Z',
    } as PersistedCat21Listing;
    let result: PersistedCat21Listing | null = null;
    service.publishListing(publishArgs()).subscribe({ next: (r) => { result = r; } });
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/api/v1/listings'));
    expect(sessionService.headersFor).toHaveBeenCalledWith(WALLET_ORDINALS);
    expect(req.request.headers.get('X-Cat21-Session-Address')).toBe(WALLET_ORDINALS);
    expect(req.request.headers.get('X-Cat21-Session-Signature')).toBe('sig-base64');
    expect(req.request.body).toMatchObject({
      catNumber: 42,
      cats: [42],
      askSats: 21_000,
      ordinalsAddress: WALLET_ORDINALS,
      payTo: WALLET_PAYMENT,
    });
    req.flush(persisted);
    expect(result).toEqual(persisted);
    httpMock.verify();
  });

  it('maps backend {code, detail} onto CreateListingError', async () => {
    const { service, walletService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    let caught: CreateListingError | null = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    const req = httpMock.expectOne((r) => r.method === 'POST');
    req.flush({ code: 'cats-bundle-drift', detail: 'cats moved' }, { status: 400, statusText: 'Bad Request' });
    httpMock.verify();
    expect((caught as CreateListingError | null)?.code).toBe('cats-bundle-drift');
    expect((caught as CreateListingError | null)?.detail).toBe('cats moved');
  });

  it('clears the cached session on a 401 from the backend guard', async () => {
    const { service, walletService, sessionService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    let caught: CreateListingError | null = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    const req = httpMock.expectOne((r) => r.method === 'POST');
    req.flush({ code: 'session-expired', detail: 'ISO past' }, { status: 401, statusText: 'Unauthorized' });
    httpMock.verify();
    expect((caught as CreateListingError | null)?.code).toBe('session-expired');
    expect(sessionService.clearFor).toHaveBeenCalledWith(WALLET_ORDINALS);
  });
});

describe('Cat21ListingService.deleteListingForCat', () => {

  it('DELETEs the listing with session headers', async () => {
    const { service, walletService, sessionService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    service.deleteListingForCat(42).subscribe({ next: () => {} });
    const req = httpMock.expectOne((r) => r.method === 'DELETE' && r.url.endsWith('/api/v1/listings/cat/42'));
    expect(sessionService.headersFor).toHaveBeenCalledWith(WALLET_ORDINALS);
    expect(req.request.headers.get('X-Cat21-Session-Address')).toBe(WALLET_ORDINALS);
    req.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.verify();
  });

  it('errors wallet-not-connected on delete when no wallet is present', async () => {
    const { service } = await setup();
    let caught: CreateListingError | null = null;
    service.deleteListingForCat(42).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect((caught as CreateListingError | null)?.code).toBe('wallet-not-connected');
  });
});

describe('Cat21ListingService.getListingForCat', () => {

  it('returns null on 404 (unlisted cat)', async () => {
    const { service, httpMock } = await setup();
    let result: PersistedCat21Listing | null | undefined;
    service.getListingForCat(999).subscribe({ next: (r) => { result = r; } });
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/v1/listings/cat/999'));
    req.flush('', { status: 404, statusText: 'Not Found' });
    expect(result).toBeNull();
    httpMock.verify();
  });

  it('returns the listing on 200', async () => {
    const { service, httpMock } = await setup();
    const persisted = { id: 'x', catNumber: 42, cats: [42], askSats: 21_000, payTo: WALLET_PAYMENT, catTxid: 'ab'.repeat(32), catVout: 0, network: 'mainnet', ordinalsAddress: WALLET_ORDINALS, signedAt: 0, signature: '', createdAt: '2026-07-25T00:00:00Z' } as PersistedCat21Listing;
    let result: PersistedCat21Listing | null | undefined;
    service.getListingForCat(42).subscribe({ next: (r) => { result = r; } });
    const req = httpMock.expectOne((r) => r.method === 'GET');
    req.flush(persisted);
    expect(result).toEqual(persisted);
    httpMock.verify();
  });
});
