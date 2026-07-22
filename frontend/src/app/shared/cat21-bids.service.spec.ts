import { describe, expect, it } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BidError, Cat21BidsService, PersistedCat21Bid } from './cat21-bids.service';

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';

async function setup() {
  await TestBed.configureTestingModule({
    providers: [
      Cat21BidsService,
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  }).compileComponents();
  return {
    service: TestBed.inject(Cat21BidsService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

const bidRow = (over: Partial<PersistedCat21Bid> = {}): PersistedCat21Bid => ({
  id: 'uuid-1',
  network: 'mainnet',
  catTxid: REAL_TXID,
  catVout: 0,
  cats: [42],
  headlineCatNumber: 42,
  bidSats: 21_000,
  buyerOrdinalsAddress: 'bc1p-buyer',
  buyerPaymentAddress: 'bc1q-buyer-pay',
  sellerPaymentAddress: 'bc1q-seller-pay',
  psbtBase64: 'cHNidP8B...',
  createdAt: '2026-07-22T10:00:00Z',
  ...over,
});

describe('Cat21BidsService.getBidsForOutpoint', () => {

  it('returns the array from the backend', async () => {
    const { service, httpMock } = await setup();
    let result: PersistedCat21Bid[] | null = null;
    service.getBidsForOutpoint(REAL_TXID, 0).subscribe({ next: (r) => { result = r; } });
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith(`/api/v1/bids/outpoint/${REAL_TXID}/0`));
    req.flush([bidRow({ id: 'a' }), bidRow({ id: 'b', bidSats: 15_000, buyerOrdinalsAddress: 'bc1p-buyer-b' })]);
    httpMock.verify();
    expect(result).toHaveLength(2);
    expect(result![0].id).toBe('a');
  });

  it('returns [] on 404 (no bids on this UTXO is a normal state)', async () => {
    const { service, httpMock } = await setup();
    let result: PersistedCat21Bid[] | null = null;
    service.getBidsForOutpoint(REAL_TXID, 0).subscribe({ next: (r) => { result = r; } });
    const req = httpMock.expectOne((r) => r.method === 'GET');
    req.flush({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    httpMock.verify();
    expect(result).toEqual([]);
  });

  it('maps a backend {code, detail} error into BidError', async () => {
    const { service, httpMock } = await setup();
    let caught: any = null;
    service.getBidsForOutpoint(REAL_TXID, 0).subscribe({
      next: () => {},
      error: (e: BidError) => { caught = e as never; },
    });
    const req = httpMock.expectOne((r) => r.method === 'GET');
    req.flush(
      { code: 'network-mismatch', detail: 'wrong net' },
      { status: 400, statusText: 'Bad Request' },
    );
    httpMock.verify();
    expect(caught?.code).toBe('network-mismatch');
    expect(caught?.detail).toContain('wrong net');
  });

  it('surfaces network-error on a raw HTTP error (no body)', async () => {
    const { service, httpMock } = await setup();
    let caught: any = null;
    service.getBidsForOutpoint(REAL_TXID, 0).subscribe({
      next: () => {},
      error: (e: BidError) => { caught = e as never; },
    });
    const req = httpMock.expectOne((r) => r.method === 'GET');
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
    httpMock.verify();
    expect(caught?.code).toBe('network-error');
  });
});

describe('Cat21BidsService.deleteBid', () => {

  it('DELETEs with the buyer as a query param', async () => {
    const { service, httpMock } = await setup();
    service.deleteBid(REAL_TXID, 0, 'bc1p-buyer').subscribe({ next: () => {} });
    const req = httpMock.expectOne(
      (r) => r.method === 'DELETE' && r.url.startsWith(`/api/v1/bids/outpoint/${REAL_TXID}/0`) || r.url.includes(`buyer=bc1p-buyer`) || r.url.endsWith(`buyer=bc1p-buyer`),
    );
    // URL-encoding of the buyer parameter.
    expect(req.request.url).toContain('buyer=bc1p-buyer');
    req.flush(null, { status: 204, statusText: 'No Content' });
    httpMock.verify();
  });

  it('maps backend errors into BidError', async () => {
    const { service, httpMock } = await setup();
    let caught: any = null;
    service.deleteBid(REAL_TXID, 0, 'bc1p-buyer').subscribe({
      next: () => {},
      error: (e: BidError) => { caught = e as never; },
    });
    const req = httpMock.expectOne((r) => r.method === 'DELETE');
    req.flush({ code: 'persist-race', detail: 'stale' }, { status: 400, statusText: 'Bad Request' });
    httpMock.verify();
    expect(caught?.code).toBe('persist-race');
  });
});
