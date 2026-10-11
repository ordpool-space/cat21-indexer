/**
 * @test-kind unit
 * Real:   OrdApiService
 * Faked:  cat21-ord and the full ord -> HttpTestingController (bodies written in the spec after ord's JSON API)
 *         global fetch (cats-at-output, which reads through the SDK's cat21OrdFetchReader) -> jest.fn answering
 *         cat21OrdOutputWithCatFixture, cat21OrdOutputWithoutCatsFixture, cat21OrdCatInscriptionFixture,
 *         cat21OrdOutputNotFoundBody (ordpool-sdk/testing, captured from cat21-ord 486f5338 on regtest, 2026-10-11)
 * Proves: each ord read hits the right URL and maps the answer; cats-at-output reads the configured cat21-ord
 *         through the SDK's getCatsAtOutput, emitting null for an unknown outpoint and erroring on anything else
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  cat21OrdCatInscriptionFixture,
  cat21OrdOutputNotFoundBody,
  cat21OrdOutputWithCatFixture,
  cat21OrdOutputWithoutCatsFixture,
} from 'ordpool-sdk/testing';

import { environment } from '../../environments/environment';
import { OrdApiService } from './ord-api.service';

describe('OrdApiService', () => {
  let service: OrdApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OrdApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrdApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getCurrentOwner maps the /cat response to its address (with an Accept: json header)', () => {
    let owner: string | null | undefined;
    service.getCurrentOwner(42).subscribe((a) => (owner = a));
    const req = http.expectOne(`${environment.ordExplorer}/cat/42`);
    expect(req.request.headers.get('Accept')).toBe('application/json');
    req.flush({ address: 'bc1p-owner' });
    expect(owner).toBe('bc1p-owner');
  });

  it('getBlock omits the page param on page 0 and includes it when > 0', () => {
    service.getBlock(800000).subscribe();
    const r0 = http.expectOne((r) => r.url === `${environment.ordExplorer}/inscriptions/block/800000`);
    expect(r0.request.params.has('page')).toBe(false);
    r0.flush({ ids: [], cat_numbers: [], more: false, page_index: 0 });

    service.getBlock(800000, 2).subscribe();
    const r1 = http.expectOne(
      (r) => r.url === `${environment.ordExplorer}/inscriptions/block/800000` && r.params.get('page') === '2',
    );
    r1.flush({ ids: [], cat_numbers: [], more: false, page_index: 2 });
  });

  it('getSatInscriptions returns the inscriptions array, defaulting to [] when absent', () => {
    let a: string[] | undefined;
    service.getSatInscriptions(100).subscribe((x) => (a = x));
    http.expectOne(`${environment.ordFullExplorer}/sat/100`).flush({ inscriptions: ['abci0'] });
    expect(a).toEqual(['abci0']);

    let b: string[] | undefined;
    service.getSatInscriptions(200).subscribe((x) => (b = x));
    http.expectOne(`${environment.ordFullExplorer}/sat/200`).flush({});
    expect(b).toEqual([]);
  });

  it('getInscription / getOutput / getSat / getAddress hit the ord explorer with the right path', () => {
    service.getInscription('abci0').subscribe();
    http.expectOne(`${environment.ordExplorer}/inscription/abci0`).flush({ id: 'abci0', number: 0, address: null, satpoint: 't:0:0', sat: 1 });

    service.getOutput('t:0').subscribe();
    http.expectOne(`${environment.ordExplorer}/output/t:0`).flush({ outpoint: 't:0', address: null, script_pubkey: '', cats: [], sat_ranges: [] });

    service.getSat(5).subscribe();
    http.expectOne(`${environment.ordExplorer}/sat/5`).flush({ address: null, block: 1, cat_numbers: [], cats: [], charms: [], name: 'a', satpoint: null });

    service.getAddress('bc1p-x').subscribe();
    http.expectOne(`${environment.ordExplorer}/address/bc1p-x`).flush({ outputs: [], cats: [], cat_numbers: [], sat_balance: 0 });
  });
});

describe('OrdApiService.getCatsAtOutput (the SDK getCatsAtOutput over cat21-ord)', () => {
  const [catTxid, catVoutRaw] = cat21OrdOutputWithCatFixture.outpoint.split(':');
  const catVout = Number(catVoutRaw);
  const catId = cat21OrdOutputWithCatFixture.cats[0];

  let service: OrdApiService;
  let fetchFake: jest.Mock<(input: unknown, init?: RequestInit) => Promise<unknown>>;
  const realFetch = globalThis.fetch;

  /** The part of a fetch Response the SDK reader reads, carrying a captured cat21-ord body. */
  function answer(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }

  /** Fake cat21-ord: exact URL -> answer. Any other URL rejects, so an unexpected read fails the test. */
  function fakeCat21Ord(routes: Record<string, ReturnType<typeof answer>>): void {
    fetchFake.mockImplementation(async (input: unknown) => {
      const route = routes[String(input)];
      if (!route) throw new Error(`unexpected url ${String(input)}`);
      return route;
    });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OrdApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrdApiService);
    fetchFake = jest.fn<(input: unknown, init?: RequestInit) => Promise<unknown>>();
    globalThis.fetch = fetchFake as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('resolves the inscription ids /output lists through /inscription on the configured cat21-ord', async () => {
    fakeCat21Ord({
      [`${environment.ordExplorer}/output/${catTxid}:${catVout}`]: answer(200, cat21OrdOutputWithCatFixture),
      [`${environment.ordExplorer}/inscription/${catId}`]: answer(200, cat21OrdCatInscriptionFixture),
    });

    expect(await firstValueFrom(service.getCatsAtOutput(catTxid, catVout))).toEqual([cat21OrdCatInscriptionFixture.number]);
    expect(fetchFake.mock.calls.map(([url]) => String(url))).toEqual([
      `${environment.ordExplorer}/output/${catTxid}:${catVout}`,
      `${environment.ordExplorer}/inscription/${catId}`,
    ]);
  });

  it('reads nothing until subscribed', () => {
    service.getCatsAtOutput(catTxid, catVout);
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it('emits [] for an output that carries no cat', async () => {
    const [txid, vout] = cat21OrdOutputWithoutCatsFixture.outpoint.split(':');
    fakeCat21Ord({
      [`${environment.ordExplorer}/output/${txid}:${vout}`]: answer(200, cat21OrdOutputWithoutCatsFixture),
    });

    expect(await firstValueFrom(service.getCatsAtOutput(txid, Number(vout)))).toEqual([]);
  });

  it('emits null when cat21-ord 404s the outpoint', async () => {
    fakeCat21Ord({
      [`${environment.ordExplorer}/output/${catTxid}:${catVout}`]: answer(404, cat21OrdOutputNotFoundBody),
    });

    expect(await firstValueFrom(service.getCatsAtOutput(catTxid, catVout))).toBeNull();
  });

  it('errors on a malformed answer instead of shrinking the list', async () => {
    fakeCat21Ord({
      [`${environment.ordExplorer}/output/${catTxid}:${catVout}`]: answer(200, { ...cat21OrdOutputWithCatFixture, cats: [42] }),
    });

    await expect(firstValueFrom(service.getCatsAtOutput(catTxid, catVout))).rejects.toThrow('not an inscription id');
  });
});
