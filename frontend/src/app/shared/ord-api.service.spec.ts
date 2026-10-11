/**
 * @test-kind unit
 * Real:   OrdApiService
 * Faked:  cat21-ord and the full ord -> HttpTestingController (bodies written in the spec after ord's JSON API)
 * Proves: each ord read hits the right URL and maps the answer, cats-at-output included
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

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

  it('getCatsAtOutput resolves the inscription ids cat21-ord lists to cat numbers, deduped and sorted', () => {
    // cat21-ord's /output answer lists cats as inscription ids (`<txid>i<n>`),
    // as the regtest bid round-trip in cat21wallet-mint-regtest.e2e.spec.ts
    // asserts against a real cat21-ord; /inscription/<id> carries the number.
    const idA = `${'a'.repeat(64)}i0`;
    const idB = `${'b'.repeat(64)}i0`;
    let cats: number[] | undefined;
    service.getCatsAtOutput('deadbeef', 0).subscribe((c) => (cats = c));
    http.expectOne(`${environment.ordExplorer}/output/deadbeef:0`).flush({ cats: [idA, idB, idA] });
    const lookups = http.match((r) => r.url.startsWith(`${environment.ordExplorer}/inscription/`));
    expect(lookups.map((r) => r.request.url)).toEqual([
      `${environment.ordExplorer}/inscription/${idA}`,
      `${environment.ordExplorer}/inscription/${idB}`,
      `${environment.ordExplorer}/inscription/${idA}`,
    ]);
    lookups[0].flush({ id: idA, number: 42 });
    lookups[1].flush({ id: idB, number: 7 });
    lookups[2].flush({ id: idA, number: 42 });
    expect(cats).toEqual([7, 42]);
  });

  it('getCatsAtOutput passes numeric entries through and drops negative or fractional ones', () => {
    let cats: number[] | undefined;
    service.getCatsAtOutput('deadbeef', 2).subscribe((c) => (cats = c));
    http.expectOne(`${environment.ordExplorer}/output/deadbeef:2`).flush({ cats: [42, -1, 3.5, 9, 42] });
    expect(cats).toEqual([9, 42]);
  });

  it('getCatsAtOutput returns [] for an output with no cats', () => {
    let cats: number[] | undefined;
    service.getCatsAtOutput('deadbeef', 1).subscribe((c) => (cats = c));
    http.expectOne(`${environment.ordExplorer}/output/deadbeef:1`).flush({ cats: [] });
    expect(cats).toEqual([]);
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
