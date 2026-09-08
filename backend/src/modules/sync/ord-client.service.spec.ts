import { OrdClientService } from './ord-client.service';

const BASE_URL = 'https://ord.test';

function createService(): OrdClientService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(BASE_URL),
  } as any;
  return new OrdClientService(configService);
}

describe('OrdClientService', () => {
  let service: OrdClientService;

  beforeEach(() => {
    service = createService();
    jest.restoreAllMocks();
  });

  describe('getCat', () => {
    it('should return cat detail for a valid cat number', async () => {
      const mockCat = {
        id: 'abc123i0',
        number: 0,
        address: 'bc1p...',
        sat: 596964966600565,
        fee: 40834,
        height: 824205,
        timestamp: 1704315886,
        value: 546,
        weight: 705,
      };

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockCat),
      } as any);

      const result = await service.getCat(0);
      expect(result).toEqual(mockCat);
      expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/cat/0`,
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        }),
      );
    });

    it('should return null for 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      const result = await service.getCat(999999);
      expect(result).toBeNull();
    });

    it('should throw on non-404 errors', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      await expect(service.getCat(0)).rejects.toThrow('ord API error: 500');
    });
  });

  describe('getLatestCatNumber', () => {
    it('should return the number of the newest cat', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      // First call: /cats page
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ids: ['abc123i0', 'def456i0'] }),
      } as any);

      // Second call: /cat/abc123i0 detail
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'abc123i0', number: 63731 }),
      } as any);

      const result = await service.getLatestCatNumber();
      expect(result).toBe(63731);
    });

    it('should return -1 when no cats exist', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ids: [] }),
      } as any);

      const result = await service.getLatestCatNumber();
      expect(result).toBe(-1);
    });

    // Callers that pass allow404=false get a throw on 404, unlike getCat,
    // which opts in to allow404 and resolves null instead.
    it('should throw on 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any);

      await expect(service.getLatestCatNumber()).rejects.toThrow('ord API error: 404');
    });
  });

  describe('getCatsAtOutput', () => {
    it('maps cat21-ord `/output` inscription-id strings to cat numbers', async () => {
      // cat21-ord re-emits ord's `inscriptions` array as `cats`, whose entries
      // are inscription-id strings — NOT numbers. getCatsAtOutput must resolve
      // each to its cat number via /cat/<id>.
      jest.spyOn(global, 'fetch').mockImplementation((input: any) => {
        const url = String(input);
        if (url.includes('/output/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ cats: ['bbb222i0', 'aaa111i0'] }),
          } as any);
        }
        if (url.endsWith('/cat/aaa111i0')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: 'aaa111i0', number: 7 }),
          } as any);
        }
        if (url.endsWith('/cat/bbb222i0')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: 'bbb222i0', number: 42 }),
          } as any);
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });

      expect(await service.getCatsAtOutput('deadbeef', 0)).toEqual([7, 42]);
    });

    it('returns [] when the output carries no cats', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ cats: [] }),
      } as any);

      expect(await service.getCatsAtOutput('deadbeef', 0)).toEqual([]);
    });

    it('returns null when ord 404s the outpoint', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any);

      expect(await service.getCatsAtOutput('deadbeef', 0)).toBeNull();
    });
  });
});

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);

/** Route a fetch spy by URL substring -> {status, body}. Missing route -> reject. */
function routeFetch(routes: Array<[string, { status?: number; ok?: boolean; body?: unknown }]>) {
  jest.spyOn(global, 'fetch').mockImplementation((input: unknown) => {
    const url = String(input);
    for (const [needle, r] of routes) {
      if (url.includes(needle)) {
        const status = r.status ?? 200;
        return Promise.resolve({
          ok: r.ok ?? (status >= 200 && status < 300),
          status,
          statusText: 'x',
          json: () => Promise.resolve(r.body ?? null),
        } as unknown as Response);
      }
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

describe('OrdClientService.getCatCurrentLocation', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('resolves the current outpoint + owning address via /cat then /inscription', async () => {
    routeFetch([
      ['/cat/42', { body: { id: 'insc-42i0', number: 42 } }],
      ['/inscription/insc-42i0', { body: { satpoint: `${TXID_A}:2:0`, address: 'bc1p-owner' } }],
    ]);
    const res = await createService().getCatCurrentLocation(42);
    expect(res).toEqual({ txid: TXID_A, vout: 2, ordinalsAddress: 'bc1p-owner' });
  });

  it('returns null when the cat does not exist (getCat 404)', async () => {
    routeFetch([['/cat/999', { status: 404, ok: false }]]);
    expect(await createService().getCatCurrentLocation(999)).toBeNull();
  });

  it('returns null when the inscription lookup 404s', async () => {
    routeFetch([
      ['/cat/42', { body: { id: 'insc-42i0', number: 42 } }],
      ['/inscription/insc-42i0', { status: 404, ok: false }],
    ]);
    expect(await createService().getCatCurrentLocation(42)).toBeNull();
  });

  it('returns null when the satpoint has no owning address (cat at OP_RETURN / fee)', async () => {
    routeFetch([
      ['/cat/42', { body: { id: 'insc-42i0', number: 42 } }],
      ['/inscription/insc-42i0', { body: { satpoint: `${TXID_A}:0:0`, address: null } }],
    ]);
    expect(await createService().getCatCurrentLocation(42)).toBeNull();
  });

  it('returns null when the satpoint is malformed', async () => {
    routeFetch([
      ['/cat/42', { body: { id: 'insc-42i0', number: 42 } }],
      ['/inscription/insc-42i0', { body: { satpoint: 'not-a-satpoint', address: 'bc1p-owner' } }],
    ]);
    expect(await createService().getCatCurrentLocation(42)).toBeNull();
  });
});

describe('OrdClientService.getCatsAtOutput — numeric + non-array branches', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('passes numeric entries through, dedupes, and sorts ascending', async () => {
    routeFetch([['/output/', { body: { cats: [42, 7, 42, 0] } }]]);
    expect(await createService().getCatsAtOutput(TXID_A, 0)).toEqual([0, 7, 42]);
  });

  it('drops negative / non-integer numeric entries', async () => {
    routeFetch([['/output/', { body: { cats: [5, -1, 3.5, 9] } }]]);
    expect(await createService().getCatsAtOutput(TXID_A, 0)).toEqual([5, 9]);
  });

  it('returns [] when `cats` is not an array', async () => {
    routeFetch([['/output/', { body: { cats: undefined } }]]);
    expect(await createService().getCatsAtOutput(TXID_A, 0)).toEqual([]);
  });
});

describe('parseSatpoint', () => {
  // imported lazily to keep the pure-fn test independent of the service
  const { parseSatpoint } = jest.requireActual('./ord-client.service') as typeof import('./ord-client.service');

  it('parses TXID:VOUT:OFFSET, lowercasing the txid', () => {
    expect(parseSatpoint(`${TXID_A.toUpperCase()}:3:100`)).toEqual({ txid: TXID_A, vout: 3 });
  });
  it.each([
    ['too few parts', `${TXID_A}:3`],
    ['too many parts', `${TXID_A}:3:0:0`],
    ['non-hex txid', `zz${'a'.repeat(62)}:0:0`],
    ['short txid', `abc:0:0`],
    ['negative vout', `${TXID_A}:-1:0`],
    ['non-numeric vout', `${TXID_A}:x:0`],
  ])('returns null for %s', (_label, bad) => {
    expect(parseSatpoint(bad)).toBeNull();
  });
});
