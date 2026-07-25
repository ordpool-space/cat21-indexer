import { ConfigService } from '@nestjs/config';

import { ElectrsClientService } from './electrs-client.service';

/**
 * These specs pin the client's contract with electrs.
 *
 * `getOutpointStatus` returns a tri-state — callers distinguish
 * 'spent' (destructive → prune / reject), 'unspent' (all good), and
 * 'unknown' (fail-safe, don't mutate).
 *
 * Key behaviour: a 404 collapses into `'spent'`, NOT `'unknown'`.
 * An outpoint referencing a txid electrs never saw is a phantom —
 * unbroadcastable in both directions — so the pruner drops it and
 * the POST-time validation rejects it. This is the fix for the
 * 2026-07-25 phantom-input finding.
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
