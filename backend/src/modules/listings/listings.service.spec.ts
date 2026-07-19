import { BadRequestException } from '@nestjs/common';

import { ListingsService } from './listings.service';

// ---------------------------------------------------------------------------
// Mock the SDK's verify. The SDK spec (48 tests) exhaustively covers the
// crypto path — HERE we test our ADAPTER: does the service correctly turn
// each verify outcome into the right BadRequest code, does it call the
// on-chain cross-check in the right order, does it upsert correctly.
// Mocking the SDK pins the service's flow control, not the verify
// correctness.
// ---------------------------------------------------------------------------

let mockVerify: jest.Mock;
let mockBuildMessage: jest.Mock;

jest.mock('ordpool-sdk/core', () => ({
  buildListingMessage: (fields: unknown) => mockBuildMessage(fields),
  verifyListingSignature: (args: unknown) => mockVerify(args),
}));

// ---------------------------------------------------------------------------

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const OTHER_TXID = 'ff'.repeat(32);
const ORD_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const OTHER_ORD_ADDR = 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh';
const PAY_ADDR = 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm';

const NOW_S = 1_784_419_200; // fixed clock for anti-replay tests

// Freshly-signed listing DTO shape. `signedAt` = NOW_S so it's inside the
// anti-replay window by default; tests that care shift it explicitly.
const validDto = (over: Partial<Parameters<ListingsService['create']>[0]> = {}) => ({
  catNumber: 42,
  askSats: 21_000,
  payTo: PAY_ADDR,
  catTxid: REAL_TXID,
  catVout: 0,
  ordinalsAddress: ORD_ADDR,
  signedAt: NOW_S,
  signature: 'AUHd69PrJQEv+oKTfZ8l+WROBHuy9HKrbFCJu7U1iK2iiEy1vMU5EfMtjc+VSHM7aU0SDbak5IUZRVno2P5mjSafAQ==',
  ...over,
});

// Simple query-builder mock — every method returns `this` except the
// terminal ones (limit, offset, then Promise). Overrides give the
// terminal shape for a specific test.
function createDrizzleMock(overrides: Record<string, jest.Mock> = {}) {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    offset: jest.fn().mockResolvedValue([]),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onDuplicateKeyUpdate: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockReturnThis(),
    ...overrides,
  };
  return { db: chain };
}

function createOrdMock(location: unknown = null, throwOnLookup = false) {
  return {
    getCatCurrentLocation: jest.fn().mockImplementation(() => {
      if (throwOnLookup) throw new Error('ord unreachable');
      return Promise.resolve(location);
    }),
  };
}

// ---------------------------------------------------------------------------

describe('ListingsService.create — signature verification', () => {

  beforeEach(() => {
    mockVerify = jest.fn().mockReturnValue({ ok: true });
    mockBuildMessage = jest.fn().mockReturnValue('some-message');
    jest.spyOn(Date, 'now').mockReturnValue(NOW_S * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects with signature-* code when verify returns ok=false', async () => {
    mockVerify.mockReturnValue({ ok: false, reason: 'signature-does-not-verify', detail: 'schnorr false' });
    const drizzle = createDrizzleMock();
    const ord = createOrdMock();
    const service = new ListingsService(drizzle as never, ord as never);

    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'signature-signature-does-not-verify' }),
    });
    // ord should NOT be consulted when the signature itself is invalid.
    expect(ord.getCatCurrentLocation).not.toHaveBeenCalled();
  });

  it('maps every SDK rejection reason into a signature-* code', async () => {
    const reasons = [
      'malformed-signature',
      'unsupported-address-type',
      'invalid-address',
      'signature-does-not-verify',
    ];
    for (const reason of reasons) {
      mockVerify.mockReturnValue({ ok: false, reason });
      const service = new ListingsService(createDrizzleMock() as never, createOrdMock() as never);
      await expect(service.create(validDto())).rejects.toMatchObject({
        response: expect.objectContaining({ code: `signature-${reason}` }),
      });
    }
  });

  it('rejects invalid-listing-fields when buildListingMessage throws (e.g. UPPERCASE txid)', async () => {
    mockBuildMessage.mockImplementation(() => { throw new Error('catTxid must be 64-char lowercase hex'); });
    const service = new ListingsService(createDrizzleMock() as never, createOrdMock() as never);
    await expect(service.create(validDto({ catTxid: REAL_TXID.toUpperCase() }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'invalid-listing-fields' }),
    });
    // Neither verify nor ord should be reached — field shape fails first.
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe('ListingsService.create — anti-replay window', () => {

  beforeEach(() => {
    mockVerify = jest.fn().mockReturnValue({ ok: true });
    mockBuildMessage = jest.fn().mockReturnValue('some-message');
    jest.spyOn(Date, 'now').mockReturnValue(NOW_S * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects signature-too-old when signedAt is > 24h in the past', async () => {
    const service = new ListingsService(createDrizzleMock() as never, createOrdMock() as never);
    await expect(service.create(validDto({ signedAt: NOW_S - 25 * 3600 }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'signature-too-old' }),
    });
  });

  it('accepts a signedAt exactly at the 24h back edge (inclusive floor)', async () => {
    // NOW_S - 24h exactly is the boundary; the check is `signedAt < NOW_S - MAX`,
    // so exactly equal passes.
    const ord = createOrdMock({ txid: REAL_TXID, vout: 0, ordinalsAddress: ORD_ADDR });
    const dbSelectResult = [{
      id: 'uuid-1', catNumber: 42, askSats: 21_000, payTo: PAY_ADDR, catTxid: REAL_TXID,
      catVout: 0, ordinalsAddress: ORD_ADDR, signedAt: NOW_S - 24 * 3600,
      signature: 'sig', createdAt: new Date(NOW_S * 1000),
    }];
    const drizzle = createDrizzleMock({ limit: jest.fn().mockResolvedValue(dbSelectResult) });
    const service = new ListingsService(drizzle as never, ord as never);
    await expect(service.create(validDto({ signedAt: NOW_S - 24 * 3600 }))).resolves.toBeDefined();
  });

  it('rejects signature-in-future when signedAt is > 1h in the future', async () => {
    const service = new ListingsService(createDrizzleMock() as never, createOrdMock() as never);
    await expect(service.create(validDto({ signedAt: NOW_S + 2 * 3600 }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'signature-in-future' }),
    });
  });
});

describe('ListingsService.create — on-chain cross-check', () => {

  beforeEach(() => {
    mockVerify = jest.fn().mockReturnValue({ ok: true });
    mockBuildMessage = jest.fn().mockReturnValue('some-message');
    jest.spyOn(Date, 'now').mockReturnValue(NOW_S * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects ord-lookup-failed when ord throws', async () => {
    const ord = createOrdMock(null, true);
    const service = new ListingsService(createDrizzleMock() as never, ord as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ord-lookup-failed' }),
    });
  });

  it('rejects cat-not-found when ord returns null (unspendable output or unknown cat)', async () => {
    const ord = createOrdMock(null);
    const service = new ListingsService(createDrizzleMock() as never, ord as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'cat-not-found' }),
    });
  });

  it('rejects not-current-owner when signature is valid but the address does not own the cat right now', async () => {
    const ord = createOrdMock({ txid: REAL_TXID, vout: 0, ordinalsAddress: OTHER_ORD_ADDR });
    const service = new ListingsService(createDrizzleMock() as never, ord as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'not-current-owner' }),
    });
  });

  it('rejects outpoint-mismatch when the cat has moved since signing', async () => {
    const ord = createOrdMock({ txid: OTHER_TXID, vout: 0, ordinalsAddress: ORD_ADDR });
    const service = new ListingsService(createDrizzleMock() as never, ord as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'outpoint-mismatch' }),
    });
  });

  it('rejects outpoint-mismatch when only vout differs', async () => {
    const ord = createOrdMock({ txid: REAL_TXID, vout: 1, ordinalsAddress: ORD_ADDR });
    const service = new ListingsService(createDrizzleMock() as never, ord as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'outpoint-mismatch' }),
    });
  });
});

describe('ListingsService.create — happy path + upsert', () => {

  beforeEach(() => {
    mockVerify = jest.fn().mockReturnValue({ ok: true });
    mockBuildMessage = jest.fn().mockReturnValue('some-message');
    jest.spyOn(Date, 'now').mockReturnValue(NOW_S * 1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts on ok + on-chain match + within-window and reads back the DTO', async () => {
    const ord = createOrdMock({ txid: REAL_TXID, vout: 0, ordinalsAddress: ORD_ADDR });
    const persistedRow = {
      id: 'uuid-1', catNumber: 42, askSats: 21_000, payTo: PAY_ADDR, catTxid: REAL_TXID,
      catVout: 0, ordinalsAddress: ORD_ADDR, signedAt: NOW_S, signature: 'sig',
      createdAt: new Date(NOW_S * 1000),
    };
    const drizzle = createDrizzleMock({
      limit: jest.fn().mockResolvedValue([persistedRow]),
    });
    const service = new ListingsService(drizzle as never, ord as never);

    const result = await service.create(validDto());
    expect(result).toMatchObject({
      catNumber: 42,
      askSats: 21_000,
      payTo: PAY_ADDR,
      catTxid: REAL_TXID,
      catVout: 0,
      ordinalsAddress: ORD_ADDR,
    });
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // upsert (insert + onDuplicateKeyUpdate) chain was called.
    expect(drizzle.db.insert).toHaveBeenCalled();
    expect(drizzle.db.onDuplicateKeyUpdate).toHaveBeenCalled();
  });

  it('throws persist-race when readback returns nothing (concurrent prune)', async () => {
    const ord = createOrdMock({ txid: REAL_TXID, vout: 0, ordinalsAddress: ORD_ADDR });
    // .limit(1) returns []  → row disappeared between insert and readback.
    const drizzle = createDrizzleMock({ limit: jest.fn().mockResolvedValue([]) });
    const service = new ListingsService(drizzle as never, ord as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'persist-race' }),
    });
  });
});

describe('ListingsService.findByCatNumber', () => {

  it('returns the DTO when the row exists', async () => {
    const row = {
      id: 'uuid-1', catNumber: 42, askSats: 21_000, payTo: PAY_ADDR, catTxid: REAL_TXID,
      catVout: 0, ordinalsAddress: ORD_ADDR, signedAt: NOW_S, signature: 'sig',
      createdAt: new Date(NOW_S * 1000),
    };
    const drizzle = createDrizzleMock({ limit: jest.fn().mockResolvedValue([row]) });
    const service = new ListingsService(drizzle as never, createOrdMock() as never);
    const result = await service.findByCatNumber(42);
    expect(result?.catNumber).toBe(42);
  });

  it('returns null when the row does not exist', async () => {
    const drizzle = createDrizzleMock({ limit: jest.fn().mockResolvedValue([]) });
    const service = new ListingsService(drizzle as never, createOrdMock() as never);
    expect(await service.findByCatNumber(999)).toBeNull();
  });
});

describe('ListingsService.findPaginated — bounds', () => {

  const service = () => new ListingsService(createDrizzleMock() as never, createOrdMock() as never);

  it('rejects itemsPerPage=0', async () => {
    await expect(service().findPaginated(0, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects itemsPerPage>100', async () => {
    await expect(service().findPaginated(101, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects currentPage=0', async () => {
    await expect(service().findPaginated(25, 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer itemsPerPage', async () => {
    await expect(service().findPaginated(2.5, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ListingsService.deleteByCatNumber', () => {

  it('runs the delete query with the catNumber', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const drizzle = createDrizzleMock({
      delete: jest.fn().mockReturnValue({ where }),
    });
    const service = new ListingsService(drizzle as never, createOrdMock() as never);
    await service.deleteByCatNumber(42);
    expect(drizzle.db.delete).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });
});
