import { BadRequestException } from '@nestjs/common';

import { BidsService } from './bids.service';

// ---------------------------------------------------------------------------
// This spec exercises the service's flow-control layer. The heavy lifts are
// mocked at their boundaries: the SDK's SIGHASH/offer validator, and
// `@scure/btc-signer`'s PSBT parser (feeding the service a scriptable
// tx-shape rather than real PSBT bytes). Coverage focus:
//
//   * pre-check ordering (network → headline → floor before parsing)
//   * PSBT parse + shape gates (input/output count, addresses, price)
//   * SDK validator wiring (translates SDK reasons into psbt-* codes)
//   * ord cats-bundle drift gate
//   * upsert + read-back happy path
//   * unique-key lookups + delete
// ---------------------------------------------------------------------------

let mockValidate: jest.Mock;
let mockFromPSBT: jest.Mock;
let mockOutScriptDecode: jest.Mock;
let mockAddressEncode: jest.Mock;

jest.mock('ordpool-sdk/core', () => ({
  validateCat21BuyOfferPsbt: (args: unknown) => mockValidate(args),
  Network: {
    Mainnet: 'mainnet',
    Testnet3: 'testnet3',
    Testnet4: 'testnet4',
    Signet: 'signet',
    Regtest: 'regtest',
  },
  MAX_ASK_SATS: 21_000_000 * 100_000_000,
}));

jest.mock('@scure/btc-signer', () => ({
  Transaction: {
    fromPSBT: (bytes: unknown, opts?: unknown) => mockFromPSBT(bytes, opts),
  },
  OutScript: {
    decode: (script: unknown) => mockOutScriptDecode(script),
  },
  Address: () => ({
    encode: (decoded: unknown) => mockAddressEncode(decoded),
  }),
  NETWORK: { name: 'mainnet' },
  TEST_NETWORK: { name: 'testnet' },
}));

// base64 module used for PSBT payload decoding. Real decode by
// default; a spec that wants to trip `psbt-malformed` overrides it.
jest.mock('@scure/base', () => {
  const actual = jest.requireActual('@scure/base');
  return actual;
});

// ---------------------------------------------------------------------------

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const OTHER_TXID = 'ff'.repeat(32);
const BUYER_ORD_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';
const BUYER_PAY_ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx';
const SELLER_PAY_ADDR = 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm';
const CAT21_POSTAGE_SATS = 546;

// Minimal PSBT stub — 4 bytes, deterministic base64.
const PSBT_STUB = 'AAECAw==';

const validDto = (over: Partial<Parameters<BidsService['create']>[0]> = {}): Parameters<BidsService['create']>[0] => ({
  network: 'mainnet',
  catTxid: REAL_TXID,
  catVout: 0,
  cats: [42],
  headlineCatNumber: 42,
  bidSats: 21_000,
  buyerOrdinalsAddress: BUYER_ORD_ADDR,
  buyerPaymentAddress: BUYER_PAY_ADDR,
  sellerPaymentAddress: SELLER_PAY_ADDR,
  psbtBase64: PSBT_STUB,
  ...over,
});

const persistedRow = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-1',
  network: 'mainnet',
  catTxid: REAL_TXID,
  catVout: 0,
  catsOnUtxo: [42],
  headlineCatNumber: 42,
  bidSats: 21_000,
  buyerOrdinalsAddress: BUYER_ORD_ADDR,
  buyerPaymentAddress: BUYER_PAY_ADDR,
  sellerPaymentAddress: SELLER_PAY_ADDR,
  psbtBase64: PSBT_STUB,
  createdAt: new Date('2026-07-22T10:00:00Z'),
  ...over,
});

/** Programmable PSBT-shape mock — set outpoint / output values / addresses. */
function buildPsbtMock(opts: {
  input0Txid?: string;
  input0Vout?: number;
  inputsLength?: number;
  outputsLength?: number;
  out0Amount?: number;
  out0Script?: Uint8Array;
  out1Amount?: number;
  out1Script?: Uint8Array;
  out2Script?: Uint8Array;
} = {}) {
  const {
    input0Txid = REAL_TXID,
    input0Vout = 0,
    inputsLength = 2,
    outputsLength = 3,
    out0Amount = CAT21_POSTAGE_SATS,
    out0Script = new Uint8Array([0x51, 0x20, 0xaa]),
    out1Amount = 21_000 + CAT21_POSTAGE_SATS,
    out1Script = new Uint8Array([0x00, 0x14, 0xbb]),
    out2Script = new Uint8Array([0x00, 0x14, 0xcc]),
  } = opts;

  // Decode-then-encode round trip: OutScript.decode returns a token, Address.encode
  // returns whichever address string was queued.
  const scriptToAddr = new Map<Uint8Array, string>([
    [out0Script, BUYER_ORD_ADDR],
    [out1Script, SELLER_PAY_ADDR],
    [out2Script, BUYER_PAY_ADDR],
  ]);
  mockOutScriptDecode.mockImplementation((script: Uint8Array) => ({ __marker: script }));
  mockAddressEncode.mockImplementation((decoded: { __marker: Uint8Array }) => {
    const addr = scriptToAddr.get(decoded.__marker);
    if (!addr) throw new Error('unrecognised script in test');
    return addr;
  });

  const input0TxidBytes = input0Txid.match(/../g)!.map((h) => parseInt(h, 16));
  const tx = {
    inputsLength,
    outputsLength,
    getInput(i: number) {
      if (i === 0) return { txid: new Uint8Array(input0TxidBytes), index: input0Vout };
      return { txid: new Uint8Array(32), index: 0 };
    },
    getOutput(i: number) {
      if (i === 0) return { script: out0Script, amount: BigInt(out0Amount) };
      if (i === 1) return { script: out1Script, amount: BigInt(out1Amount) };
      return { script: out2Script, amount: BigInt(1_000) };
    },
  };
  mockFromPSBT.mockReturnValue(tx);
  return tx;
}

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

function createOrdMock(opts: {
  catsAtOutput?: number[] | null;
  throwOnCatsAtOutput?: boolean;
} = {}) {
  const { catsAtOutput = [42], throwOnCatsAtOutput = false } = opts;
  return {
    getCatsAtOutput: jest.fn().mockImplementation(() => {
      if (throwOnCatsAtOutput) throw new Error('ord /output unreachable');
      return Promise.resolve(catsAtOutput);
    }),
  };
}

// ---------------------------------------------------------------------------

describe('BidsService.create — pre-checks (cheap fails first)', () => {

  beforeEach(() => {
    mockValidate = jest.fn().mockReturnValue({ ok: true, pricePaidSats: 21_000, postageSats: CAT21_POSTAGE_SATS });
    mockFromPSBT = jest.fn();
    mockOutScriptDecode = jest.fn();
    mockAddressEncode = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects network-mismatch when DTO network is not the backend deployment', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto({ network: 'testnet3' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'network-mismatch' }),
    });
    // PSBT parse should not fire.
    expect(mockFromPSBT).not.toHaveBeenCalled();
  });

  it('rejects headline-not-in-bundle when headlineCatNumber is missing from cats', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto({ headlineCatNumber: 999, cats: [42, 100] }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'headline-not-in-bundle' }),
    });
    expect(mockFromPSBT).not.toHaveBeenCalled();
  });

  it('rejects bid-below-marketplace-floor for bidSats below the spam gate', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto({ bidSats: 500 }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'bid-below-marketplace-floor' }),
    });
    expect(mockFromPSBT).not.toHaveBeenCalled();
  });
});

describe('BidsService.create — PSBT decode + shape', () => {

  beforeEach(() => {
    mockValidate = jest.fn().mockReturnValue({ ok: true, pricePaidSats: 21_000, postageSats: CAT21_POSTAGE_SATS });
    mockFromPSBT = jest.fn();
    mockOutScriptDecode = jest.fn();
    mockAddressEncode = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects psbt-malformed when base64 decode fails', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto({ psbtBase64: '@@@invalid base64@@@' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-malformed' }),
    });
  });

  it('rejects psbt-malformed when scure Transaction.fromPSBT throws', async () => {
    mockFromPSBT.mockImplementation(() => { throw new Error('bad PSBT magic'); });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-malformed' }),
    });
  });

  it('rejects psbt-shape-invalid when PSBT has only 1 input (no buyer funding)', async () => {
    buildPsbtMock({ inputsLength: 1 });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-shape-invalid' }),
    });
  });

  it('rejects psbt-shape-invalid when PSBT has 4 outputs (over the 3 max)', async () => {
    buildPsbtMock({ outputsLength: 4 });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-shape-invalid' }),
    });
  });

  it('rejects psbt-input0-mismatch when PSBT input 0 outpoint disagrees with DTO', async () => {
    buildPsbtMock({ input0Txid: OTHER_TXID });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-input0-mismatch' }),
    });
  });

  it('rejects psbt-shape-invalid when PSBT output 0 is not exactly 546 sats (cat postage)', async () => {
    buildPsbtMock({ out0Amount: 1000 });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-shape-invalid' }),
    });
  });

  it('rejects psbt-output0-mismatch when PSBT output 0 address ≠ DTO buyerOrdinalsAddress', async () => {
    // Override the encoded output 0 address to a different value.
    mockOutScriptDecode.mockReturnValue({ marker: true });
    mockAddressEncode.mockReturnValueOnce('bc1p-different-address').mockReturnValue(SELLER_PAY_ADDR);
    mockFromPSBT.mockReturnValue({
      inputsLength: 2,
      outputsLength: 2,
      getInput: () => ({ txid: new Uint8Array(REAL_TXID.match(/../g)!.map((h) => parseInt(h, 16))), index: 0 }),
      getOutput: (i: number) => i === 0
        ? { script: new Uint8Array([1]), amount: BigInt(CAT21_POSTAGE_SATS) }
        : { script: new Uint8Array([2]), amount: BigInt(21_000 + CAT21_POSTAGE_SATS) },
    });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-output0-mismatch' }),
    });
  });

  it('rejects psbt-price-mismatch when output 1 amount ≠ bidSats + postage', async () => {
    // PSBT claims 10_000 + postage, but DTO claims 21_000 bidSats.
    buildPsbtMock({ out1Amount: 10_000 + CAT21_POSTAGE_SATS });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-price-mismatch' }),
    });
  });
});

describe('BidsService.create — SDK validator + ord', () => {

  beforeEach(() => {
    mockValidate = jest.fn().mockReturnValue({ ok: true, pricePaidSats: 21_000, postageSats: CAT21_POSTAGE_SATS });
    mockFromPSBT = jest.fn();
    mockOutScriptDecode = jest.fn();
    mockAddressEncode = jest.fn();
    buildPsbtMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('surfaces SDK rejections as psbt-* codes', async () => {
    mockValidate.mockReturnValue({ ok: false, reason: 'sighash-not-all', detail: 'buyer input 1 is SIGHASH_NONE' });
    const service = new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'psbt-sighash-not-all' }),
    });
  });

  it('rejects ord-lookup-failed when the /output call throws', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock({ throwOnCatsAtOutput: true }) as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ord-lookup-failed' }),
    });
  });

  it('rejects cat-not-found when /output returns null', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock({ catsAtOutput: null }) as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'cat-not-found' }),
    });
  });

  it('rejects cat-not-found when /output returns empty cats', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock({ catsAtOutput: [] }) as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'cat-not-found' }),
    });
  });

  it('rejects cats-bundle-drift when the live bundle differs from the signed one', async () => {
    const service = new BidsService(createDrizzleMock() as never, createOrdMock({ catsAtOutput: [42, 99] }) as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto({ cats: [42] }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'cats-bundle-drift' }),
    });
  });
});

describe('BidsService.create — happy path + upsert', () => {

  beforeEach(() => {
    mockValidate = jest.fn().mockReturnValue({ ok: true, pricePaidSats: 21_000, postageSats: CAT21_POSTAGE_SATS });
    mockFromPSBT = jest.fn();
    mockOutScriptDecode = jest.fn();
    mockAddressEncode = jest.fn();
    buildPsbtMock();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts on ok + on-chain match and reads back the DTO', async () => {
    const drizzle = createDrizzleMock({ limit: jest.fn().mockResolvedValue([persistedRow()]) });
    const service = new BidsService(drizzle as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    const result = await service.create(validDto());
    expect(result).toMatchObject({
      network: 'mainnet',
      catTxid: REAL_TXID,
      catVout: 0,
      cats: [42],
      bidSats: 21_000,
      buyerOrdinalsAddress: BUYER_ORD_ADDR,
      sellerPaymentAddress: SELLER_PAY_ADDR,
    });
    expect(result.psbtBase64).toBe(PSBT_STUB);
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(drizzle.db.insert).toHaveBeenCalled();
    expect(drizzle.db.onDuplicateKeyUpdate).toHaveBeenCalled();
  });

  it('read-back returns the multi-cat bundle exactly as persisted', async () => {
    const drizzle = createDrizzleMock({
      limit: jest.fn().mockResolvedValue([persistedRow({ catsOnUtxo: [0, 42, 100], headlineCatNumber: 0 })]),
    });
    const service = new BidsService(
      drizzle as never,
      createOrdMock({ catsAtOutput: [0, 42, 100] }) as never,
      { get: () => "mainnet" } as never,
    );
    const result = await service.create(validDto({ cats: [0, 42, 100], headlineCatNumber: 0 }));
    expect(result.cats).toEqual([0, 42, 100]);
  });

  it('throws persist-race when readback returns nothing (concurrent prune)', async () => {
    const drizzle = createDrizzleMock({ limit: jest.fn().mockResolvedValue([]) });
    const service = new BidsService(drizzle as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await expect(service.create(validDto())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'persist-race' }),
    });
  });
});

describe('BidsService.findByOutpoint (seller view — bids on my cat)', () => {

  it('returns all bids for the UTXO', async () => {
    const rows = [
      persistedRow({ id: 'a', bidSats: 30_000, buyerOrdinalsAddress: 'bc1p-a' }),
      persistedRow({ id: 'b', bidSats: 21_000, buyerOrdinalsAddress: 'bc1p-b' }),
    ];
    const drizzle = createDrizzleMock({ orderBy: jest.fn().mockResolvedValue(rows) });
    const service = new BidsService(drizzle as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    const result = await service.findByOutpoint('mainnet', REAL_TXID, 0);
    expect(result).toHaveLength(2);
    expect(result[0].bidSats).toBe(30_000);
    expect(result[1].bidSats).toBe(21_000);
  });

  it('returns empty array when no bids exist on the UTXO', async () => {
    const drizzle = createDrizzleMock({ orderBy: jest.fn().mockResolvedValue([]) });
    const service = new BidsService(drizzle as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    expect(await service.findByOutpoint('mainnet', OTHER_TXID, 0)).toEqual([]);
  });
});

describe('BidsService.findPaginated — bounds', () => {

  const service = () => new BidsService(createDrizzleMock() as never, createOrdMock() as never, { get: () => "mainnet" } as never);

  it('rejects itemsPerPage=0', async () => {
    await expect(service().findPaginated(0, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects itemsPerPage>100', async () => {
    await expect(service().findPaginated(101, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects currentPage=0', async () => {
    await expect(service().findPaginated(25, 0)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BidsService.deleteByOutpointAndBuyer', () => {

  it('runs the delete query with the unique-key fields', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const drizzle = createDrizzleMock({
      delete: jest.fn().mockReturnValue({ where }),
    });
    const service = new BidsService(drizzle as never, createOrdMock() as never, { get: () => "mainnet" } as never);
    await service.deleteByOutpointAndBuyer('mainnet', REAL_TXID, 0, BUYER_ORD_ADDR);
    expect(drizzle.db.delete).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });
});
