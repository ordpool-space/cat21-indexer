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

  it('getCatsAtOutput normalizes cats (numeric + numeric strings), drops junk, dedupes, sorts ascending', () => {
    let cats: number[] | undefined;
    service.getCatsAtOutput('deadbeef', 0).subscribe((c) => (cats = c));
    const req = http.expectOne(`${environment.ordExplorer}/output/deadbeef:0`);
    req.flush({ cats: [42, '7', 42, -1, '3.5', 9] });
    // 42, '7'->7, 42, -1 dropped(<0), '3.5' dropped(non-int), 9 -> dedupe+sort
    expect(cats).toEqual([7, 9, 42]);
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
