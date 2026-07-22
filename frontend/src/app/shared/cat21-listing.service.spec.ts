import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';

import {
  Cat21Listing,
  KnownOrdinalWalletType,
  Network,
  WalletInfo,
  WalletService,
} from 'ordpool-sdk';

import { Cat21ListingService, CreateListingError } from './cat21-listing.service';

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
  signMessage = jest.fn();
}

async function setup(): Promise<{
  service: Cat21ListingService;
  walletService: WalletServiceStub;
  httpMock: HttpTestingController;
}> {
  const walletService = new WalletServiceStub();
  await TestBed.configureTestingModule({
    providers: [
      Cat21ListingService,
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: WalletService, useValue: walletService },
    ],
  }).compileComponents();
  return {
    service: TestBed.inject(Cat21ListingService),
    walletService,
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
    let caught: any = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    expect(caught?.code).toBe('wallet-not-connected');
  });

  it('signs via WalletService.signMessage and POSTs the listing DTO (v2 shape: includes network) with the returned signature', async () => {
    const { service, walletService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    walletService.signMessage.mockReturnValue(of({ signature: 'sig-base64-bytes' }));

    let result: Cat21Listing | null = null;
    service.publishListing(publishArgs()).subscribe({ next: (r) => { result = r; }, error: () => {} });

    // The signer got the ordinals address + a v2 message with the network line.
    expect(walletService.signMessage).toHaveBeenCalledTimes(1);
    const signArgs = walletService.signMessage.mock.calls[0]?.[0] as { address: string; message: string };
    expect(signArgs.address).toBe(WALLET_ORDINALS);
    expect(signArgs.message.startsWith('cat21-ask:v3\n')).toBe(true);
    expect(signArgs.message).toContain('network=mainnet');
    expect(signArgs.message).toContain('cats=42');
    // payTo in the message MUST be the wallet's payment address — never ordinals.
    expect(signArgs.message).toContain(`payTo=${WALLET_PAYMENT}`);
    expect(signArgs.message).not.toContain(`payTo=${WALLET_ORDINALS}`);

    // Then the HTTP POST fires. Body includes `network` (v2) so the backend
    // can cross-check against its BACKEND_NETWORK.
    const req = httpMock.expectOne((r) => r.method === 'POST' && r.url.endsWith('/api/v1/listings'));
    expect(req.request.body).toMatchObject({
      catNumber: 42,
      network: 'mainnet',
      askSats: 21_000,
      payTo: WALLET_PAYMENT,
      catTxid: publishArgs().catTxid,
      catVout: 0,
      ordinalsAddress: WALLET_ORDINALS,
      signature: 'sig-base64-bytes',
    });

    const persisted = {
      id: 'uuid-1',
      catNumber: 42,
      network: 'mainnet',
      askSats: 21_000,
      payTo: WALLET_PAYMENT,
      catTxid: publishArgs().catTxid,
      catVout: 0,
      ordinalsAddress: WALLET_ORDINALS,
      signedAt: req.request.body.signedAt,
      signature: 'sig-base64-bytes',
      createdAt: '2026-07-19T10:00:00.000Z',
    };
    req.flush(persisted);
    httpMock.verify();
    expect(result).toEqual(persisted);
  });

  it('fails wallet-swapped-mid-sign when the wallet changes between signMessage call and its resolution', async () => {
    const { service, walletService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    // Simulate the swap: the signMessage RPC returns a signature, but by
    // then the connectedWallet$ subject holds a DIFFERENT wallet's
    // address. Fail closed rather than attribute wallet B's signature to
    // wallet A's DTO.
    const OTHER_ORD = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';
    walletService.signMessage.mockImplementation(() => {
      walletService.connectedWallet$.next({ ...wallet, ordinalsAddress: OTHER_ORD });
      return of({ signature: 'sig-from-old-wallet' });
    });

    let caught: any = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    expect(caught?.code).toBe('wallet-swapped-mid-sign');
    // The HTTP POST must NOT have fired — no way to attribute the signature.
    httpMock.verify();
  });

  it('bubbles a wallet-side rejection with wallet-signature-failed', async () => {
    const { service, walletService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    walletService.signMessage.mockReturnValue(throwError(() => new Error('User rejected the message')));

    let caught: any = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    expect(caught?.code).toBe('wallet-signature-failed');
    expect(caught?.detail).toContain('User rejected');
    httpMock.verify(); // no HTTP request should have fired
  });

  it('maps backend {code, detail} error bodies through unchanged', async () => {
    const { service, walletService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    walletService.signMessage.mockReturnValue(of({ signature: 'sig' }));

    let caught: any = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    const req = httpMock.expectOne((r) => r.method === 'POST');
    req.flush(
      { code: 'not-current-owner', detail: 'address does not own cat #42' },
      { status: 400, statusText: 'Bad Request' },
    );
    httpMock.verify();
    expect(caught?.code).toBe('not-current-owner');
    expect(caught?.detail).toContain('does not own cat #42');
  });

  it('maps a raw HTTP error into network-error when the backend didn\'t answer', async () => {
    const { service, walletService, httpMock } = await setup();
    walletService.connectedWallet$.next(wallet);
    walletService.signMessage.mockReturnValue(of({ signature: 'sig' }));

    let caught: any = null;
    service.publishListing(publishArgs()).subscribe({
      next: () => {},
      error: (e: CreateListingError) => { caught = e; },
    });
    const req = httpMock.expectOne((r) => r.method === 'POST');
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    httpMock.verify();
    expect(caught?.code).toBe('network-error');
  });
});

describe('Cat21ListingService.getListingForCat', () => {

  it('returns the persisted listing when the backend has one', async () => {
    const { service, httpMock } = await setup();
    let result: Cat21Listing | null = null;
    service.getListingForCat(42).subscribe({ next: (r) => { result = r; } });
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/v1/listings/cat/42'));
    const listing = {
      id: 'x', catNumber: 42, askSats: 21_000, payTo: WALLET_PAYMENT,
      catTxid: 'aa'.repeat(32), catVout: 0, ordinalsAddress: WALLET_ORDINALS,
      signedAt: 1_700_000_000, signature: 'sig', createdAt: '2026-07-19T10:00:00Z',
    };
    req.flush(listing);
    httpMock.verify();
    expect(result).toEqual(listing);
  });

  it('returns null when the backend responds 404 (no active listing is a normal state)', async () => {
    const { service, httpMock } = await setup();
    let result: Cat21Listing | null | undefined = undefined;
    let error: unknown = null;
    service.getListingForCat(42).subscribe({
      next: (r) => { result = r; },
      error: (e) => { error = e; },
    });
    const req = httpMock.expectOne((r) => r.method === 'GET');
    req.flush({ statusCode: 404, message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    httpMock.verify();
    expect(result).toBeNull();
    expect(error).toBeNull();
  });

  it('propagates non-404 errors as CreateListingError', async () => {
    const { service, httpMock } = await setup();
    let caught: any = null;
    service.getListingForCat(42).subscribe({
      next: () => {},
      error: (e) => { caught = e; },
    });
    const req = httpMock.expectOne((r) => r.method === 'GET');
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    httpMock.verify();
    expect(caught?.code).toBe('network-error');
  });
});
