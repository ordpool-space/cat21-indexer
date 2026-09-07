import { ConfigService } from '@nestjs/config';

import { ElectrsClientService } from './electrs-client.service';

/**
 * These specs pin the client's contract with electrs.
 *
 * `getOutpointStatus` returns a tri-state — callers distinguish
 * 'spent' (destructive → prune / reject), 'unspent' (all good), and
 * 'unknown' (fail-safe, don't mutate).
 *
 * Phantom detection: an outpoint whose txid electrs never saw is
 * unspendable and collapses into `'spent'`. Our electrs answers
 * `{ spent: false }` (NOT a 404) on `/outspend` for an unknown txid
 * (verified against live electrs), so a `{ spent: false }` result is
 * confirmed against a `/tx` existence probe: `/tx` 404 → 'spent'
 * (phantom), `/tx` 200 → 'unspent' (real UTXO), `/tx` 5xx → 'unknown'
 * (fail-safe). A `/outspend` 404 still collapses straight to 'spent'
 * for electrs builds that signal a phantom that way. This is the fix
 * for the 2026-07-25 phantom-input finding, corrected to the real
 * `{ spent: false }` behavior the backend regtest lane surfaced.
 *
 * `isOutpointSpent` is a thin boolean wrapper (`status === 'spent'`)
 * kept for backward compat; new callers use the tri-state directly.
 */
describe('ElectrsClientService', () => {

  const TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
  const BASE_URL = 'https://api.example.test/api';

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeClient(): ElectrsClientService {
    const cfg = { getOrThrow: jest.fn().mockReturnValue(BASE_URL) } as unknown as ConfigService;
    return new ElectrsClientService(cfg);
  }

  // electrs `/tx/{txid}/outspend/{vout}` returns `{ spent: boolean }` on an
  // unspent output (`{ spent: true, txid, vin, status: {...} }` on a spent one),
  // and `getOutpointStatus` reads ONLY the top-level boolean `spent`. So the
  // `{ spent: … }` bodies these tests feed are electrs's REAL wire contract
  // (verified against a live electrs /outspend response), not a shape invented
  // to match the code. The real-infra backstop is `getCatsAtOutput`'s sibling
  // pattern; here the boundary contract is a single boolean, captured above.
  function stubFetch(status: number, body: unknown, opts: { throw?: Error; badJson?: boolean } = {}) {
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (opts.throw) return Promise.reject(opts.throw);
      const response = {
        status,
        ok: status >= 200 && status < 300,
        json: () => opts.badJson ? Promise.reject(new SyntaxError('bad json')) : Promise.resolve(body),
      };
      return Promise.resolve(response);
    }) as never;
  }

  // URL-aware stub for the two-call phantom path: the `/outspend` call and
  // the `/tx/{txid}` existence probe get distinct responses. The existence
  // probe URL ends in `/tx/{txid}`; `/outspend` ends in `/outspend/{vout}`.
  function stubFetchRoutes(routes: {
    outspend: { status: number; body?: unknown };
    tx: { status: number };
  }) {
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      const isExistenceProbe = /\/tx\/[0-9a-f]+$/i.test(url);
      const r = isExistenceProbe ? routes.tx : routes.outspend;
      return Promise.resolve({
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        json: () => Promise.resolve((r as { body?: unknown }).body ?? null),
      });
    }) as never;
  }

  it('returns `spent` when electrs responds {spent: true}', async () => {
    stubFetch(200, { spent: true });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('spent');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(true);
  });

  it('returns `unspent` when electrs responds {spent: false}', async () => {
    stubFetch(200, { spent: false });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unspent');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(false);
  });

  it('reports a phantom outpoint `spent`: /outspend says {spent:false} but /tx 404s', async () => {
    // Real electrs answers {spent:false} for a txid it never saw; only the
    // /tx existence probe reveals the phantom. Pins the real bug the backend
    // regtest lane caught: the pre-fix code returned 'unspent' here, so an
    // attacker's fabricated funding input slipped past phantom-input checks.
    stubFetchRoutes({ outspend: { status: 200, body: { spent: false } }, tx: { status: 404 } });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('spent');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(true);
  });

  it('reports a real unspent UTXO `unspent`: /outspend {spent:false} + /tx 200', async () => {
    stubFetchRoutes({ outspend: { status: 200, body: { spent: false } }, tx: { status: 200 } });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unspent');
  });

  it('returns `unknown` when /outspend {spent:false} but the /tx probe 5xxs (fail-safe)', async () => {
    stubFetchRoutes({ outspend: { status: 200, body: { spent: false } }, tx: { status: 503 } });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unknown');
  });

  it('collapses a 404 into `spent` (phantom txid → unbroadcastable → prune)', async () => {
    stubFetch(404, null);
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('spent');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(true);
  });

  it('returns `unknown` on a 500 (fail-safe: transient error must not cascade)', async () => {
    stubFetch(500, null);
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unknown');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(false);
  });

  it('returns `unknown` on a network error (fetch rejects)', async () => {
    stubFetch(0, null, { throw: new Error('ENOTFOUND') });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unknown');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(false);
  });

  it('returns `unknown` on malformed JSON', async () => {
    stubFetch(200, null, { badJson: true });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unknown');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(false);
  });

  it('returns `unknown` when the response body is missing the `spent` field', async () => {
    stubFetch(200, { status: 'confirmed' });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unknown');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(false);
  });

  it('returns `unknown` when the response body\'s `spent` is not a boolean', async () => {
    stubFetch(200, { spent: 'yes' });
    const client = makeClient();
    expect(await client.getOutpointStatus(TXID, 0)).toBe('unknown');
    expect(await client.isOutpointSpent(TXID, 0)).toBe(false);
  });

  it('builds the correct URL (/tx/{txid}/outspend/{vout})', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ spent: false }),
    });
    globalThis.fetch = fetchSpy as never;
    const client = makeClient();
    await client.isOutpointSpent(TXID, 3);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${BASE_URL}/tx/${TXID}/outspend/3`,
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) }),
    );
  });
});
