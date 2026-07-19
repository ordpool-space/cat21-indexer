import { describe, expect, it, jest } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { Network } from 'ordpool-sdk';

import { PersistedCat21Listing } from '../shared/cat21-listing.service';
import { Orderbook } from './orderbook';

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const PAY_ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';

const listing = (over: Partial<PersistedCat21Listing> = {}): PersistedCat21Listing => ({
  id: 'uuid-1',
  catNumber: 42,
  network: Network.Mainnet,
  askSats: 21_000,
  payTo: PAY_ADDR as never,
  catTxid: REAL_TXID,
  catVout: 0,
  ordinalsAddress: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9' as never,
  signedAt: 1_784_400_000,
  signature: 'sig',
  createdAt: '2026-07-19T10:00:00.000Z',
  ...over,
});

async function setup(opts: { ipp?: number; page?: number } = {}) {
  await TestBed.configureTestingModule({
    imports: [Orderbook],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  })
    .overrideComponent(Orderbook, { set: { template: '', imports: [] } })
    .compileComponents();

  const fixture = TestBed.createComponent(Orderbook);
  if (opts.ipp !== undefined) fixture.componentRef.setInput('itemsPerPage', opts.ipp);
  if (opts.page !== undefined) fixture.componentRef.setInput('currentPage', opts.page);
  fixture.detectChanges();

  return {
    fixture,
    component: fixture.componentInstance,
    httpMock: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
  };
}

describe('Orderbook — paginated feed loader', () => {

  it('fetches the default page (ipp=25, page=1) from /api/v1/listings/:ipp/:page', async () => {
    const { httpMock } = await setup();
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/v1/listings/25/1'));
    req.flush({ total: 0, currentPage: 1, itemsPerPage: 25, items: [] });
    httpMock.verify();
  });

  it('honors URL-supplied itemsPerPage + currentPage', async () => {
    const { httpMock } = await setup({ ipp: 10, page: 3 });
    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/v1/listings/10/3'));
    req.flush({ total: 42, currentPage: 3, itemsPerPage: 10, items: [] });
    httpMock.verify();
  });

  it('exposes the feed via feedResource.value() once loaded', async () => {
    const { component, httpMock } = await setup();
    const feed = { total: 1, currentPage: 1, itemsPerPage: 25, items: [listing()] };
    httpMock.expectOne(() => true).flush(feed);
    // rxResourceFixed updates its value signal asynchronously — one microtask cycle.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.feedResource.value()).toEqual(feed);
  });

  it('computes totalPages from total / itemsPerPage (ceil)', async () => {
    const { component, httpMock } = await setup({ ipp: 25 });
    httpMock.expectOne(() => true).flush({ total: 55, currentPage: 1, itemsPerPage: 25, items: [] });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(component.totalPages()).toBe(3);
  });

  it('totalPages defaults to 1 when the feed has not loaded yet', async () => {
    const { component } = await setup();
    // No .flush() — feed pending.
    expect(component.totalPages()).toBe(1);
  });

  it('goToPage clamps to [1, totalPages] and navigates via router', async () => {
    const { component, router, httpMock } = await setup({ ipp: 25 });
    httpMock.expectOne(() => true).flush({ total: 100, currentPage: 1, itemsPerPage: 25, items: [] });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true as never);

    component.goToPage(2);
    expect(navSpy).toHaveBeenCalledWith(['/orderbook', 25, 2]);

    // Out-of-range → no navigation.
    navSpy.mockClear();
    component.goToPage(0);
    expect(navSpy).not.toHaveBeenCalled();
    component.goToPage(5); // totalPages = 4
    expect(navSpy).not.toHaveBeenCalled();
  });
});

describe('Orderbook — buyQueryParams per row', () => {

  it('threads catNumber + askSats + sellerPaymentAddress + catOutpoint through to make-offer', async () => {
    const { component } = await setup();
    const row = listing({ catNumber: 7, askSats: 42_000, catTxid: 'bb'.repeat(32), catVout: 3 });
    const params = component.buyQueryParams(row);
    expect(params['catNumber']).toBe('7');
    expect(params['askPrice']).toBe('42000');
    expect(params['payTo']).toBe(PAY_ADDR);
    expect(params['catTxid']).toBe('bb'.repeat(32));
    expect(params['catVout']).toBe('3');
    // Intent-lock: make-offer's stale check compares this against the
    // cat's current outpoint. If the row survived the pruner's cycle
    // but got sold in between, the buyer sees "stale" instead of
    // building a doomed PSBT.
    expect(params['fromAsk']).toBe('1');
  });
});
