import { BidsPruner } from './bids.pruner';

// ---------------------------------------------------------------------------
// Mock @scure/btc-signer so pruner tests can inject a PSBT-shape without
// generating real bytes. The pruner extracts input outpoints from the
// PSBT to check them via electrs; we script the fromPSBT return value
// per-test.
// ---------------------------------------------------------------------------

let mockFromPSBT: jest.Mock;

jest.mock('@scure/btc-signer', () => ({
  Transaction: {
    fromPSBT: (...args: unknown[]) => mockFromPSBT(...args),
  },
}));

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const BUYER_A = 'bc1p-buyer-a';
const BUYER_B = 'bc1p-buyer-b';

// Buyer funding txids used across scenarios.
const FUND_TXID_LIVE = 'aa'.repeat(32);
const FUND_TXID_SPENT = 'bb'.repeat(32);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-x',
  network: 'mainnet',
  catTxid: REAL_TXID,
  catVout: 0,
  catsOnUtxo: [42],
  headlineCatNumber: 42,
  bidSats: 21_000,
  buyerOrdinalsAddress: BUYER_A,
  buyerPaymentAddress: 'bc1q-pay',
  sellerPaymentAddress: 'bc1q-seller-pay',
  psbtBase64: 'AAECAw==',
  createdAt: new Date(),
  ...over,
});

function drizzleWithRows(rows: unknown[]) {
  return {
    db: {
      select: jest.fn().mockReturnValue({ from: jest.fn().mockResolvedValue(rows) }),
    },
  };
}

/**
 * Programmable PSBT: buyer inputs 1..N pointing at whichever funding
 * txids the test wants. Input 0 is stubbed as the seller's cat UTXO
 * (never checked by the pruner directly — its outpoint is on the row).
 */
function stubPsbt(buyerFundingTxids: string[]): void {
  mockFromPSBT.mockReturnValue({
    inputsLength: buyerFundingTxids.length + 1,
    getInput(i: number) {
      if (i === 0) return { txid: new Uint8Array(32), index: 0 };
      const txid = buyerFundingTxids[i - 1];
      const bytes = new Uint8Array(txid.match(/../g)!.map((h) => parseInt(h, 16)));
      return { txid: bytes, index: 0 };
    },
  });
}

function createElectrsMock(spent: Record<string, boolean> = {}) {
  return {
    isOutpointSpent: jest.fn().mockImplementation((txid: string, _vout: number) => {
      return Promise.resolve(!!spent[txid]);
    }),
  };
}

describe('BidsPruner.runPrune — seller-side (cat UTXO drift)', () => {

  beforeEach(() => {
    mockFromPSBT = jest.fn();
    stubPsbt([FUND_TXID_LIVE]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op when the table is empty', async () => {
    const drizzle = drizzleWithRows([]);
    const ord = { getCatsAtOutput: jest.fn() };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(ord.getCatsAtOutput).not.toHaveBeenCalled();
    expect(electrs.isOutpointSpent).not.toHaveBeenCalled();
    expect(bidsSvc.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });

  it('keeps a bid whose UTXO still carries the signed cats bundle AND all buyer inputs are live', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) };
    const electrs = createElectrsMock(); // no txid marked spent → all live
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
    // Both checks ran.
    expect(ord.getCatsAtOutput).toHaveBeenCalledTimes(1);
    expect(electrs.isOutpointSpent).toHaveBeenCalledTimes(1);
  });

  it('drops on seller-side when the UTXO no longer holds cats (skips buyer-side check)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue(null) };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', REAL_TXID, 0, BUYER_A);
    // Buyer-side check is short-circuited when seller-side already killed the row.
    expect(electrs.isOutpointSpent).not.toHaveBeenCalled();
  });

  it('drops on seller-side when the live cats bundle differs from the signed one', async () => {
    const drizzle = drizzleWithRows([row({ catsOnUtxo: [42] })]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42, 99]) };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(1);
    expect(electrs.isOutpointSpent).not.toHaveBeenCalled();
  });

  it('does NOT drop a bid when the ord lookup errors (transient — retry next tick)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockRejectedValue(new Error('ord flake')) };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });
});

describe('BidsPruner.runPrune — buyer-side (funding UTXO liveness)', () => {

  beforeEach(() => {
    mockFromPSBT = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('drops a bid whose buyer funding UTXO has been spent elsewhere', async () => {
    stubPsbt([FUND_TXID_SPENT]);
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) }; // seller-side clean
    const electrs = createElectrsMock({ [FUND_TXID_SPENT]: true });
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', REAL_TXID, 0, BUYER_A);
  });

  it('drops a bid where ANY of multiple buyer funding UTXOs is spent (all-live gate)', async () => {
    // 3 buyer inputs, middle one spent.
    stubPsbt([FUND_TXID_LIVE, FUND_TXID_SPENT, FUND_TXID_LIVE]);
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) };
    const electrs = createElectrsMock({ [FUND_TXID_SPENT]: true });
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(1);
  });

  it('keeps a bid when all buyer funding UTXOs are still live', async () => {
    stubPsbt([FUND_TXID_LIVE, FUND_TXID_LIVE]);
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });

  it('drops a bid whose PSBT no longer parses (corrupt row)', async () => {
    mockFromPSBT.mockImplementation(() => { throw new Error('PSBT magic bytes wrong'); });
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(1);
  });

  it('electrs flake keeps the bid (fail-safe: unknown → live, no destructive drop on transient error)', async () => {
    // The client's fail-safe returns `false` on error → we interpret
    // as "not spent" and keep the bid. Verified by the client's own
    // spec; the pruner just trusts that contract.
    stubPsbt([FUND_TXID_LIVE]);
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) };
    const electrs = createElectrsMock(); // returns false for all
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });
});

describe('BidsPruner.runPrune — batching + re-entrancy', () => {

  beforeEach(() => {
    mockFromPSBT = jest.fn();
    stubPsbt([FUND_TXID_LIVE]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares ONE ord lookup across multiple bids on the same UTXO', async () => {
    const drizzle = drizzleWithRows([
      row({ id: 'a', buyerOrdinalsAddress: BUYER_A }),
      row({ id: 'b', buyerOrdinalsAddress: BUYER_B }),
    ]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue(null) };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(ord.getCatsAtOutput).toHaveBeenCalledTimes(1);
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(2);
  });

  it('processes multiple UTXOs independently — a stale one is dropped without hurting the live one', async () => {
    const OTHER_TXID = 'cc'.repeat(32);
    const drizzle = drizzleWithRows([
      row({ id: 'a', catTxid: REAL_TXID }),
      row({ id: 'b', catTxid: OTHER_TXID }),
    ]);
    const ord = {
      getCatsAtOutput: jest.fn()
        .mockResolvedValueOnce([42])   // REAL_TXID — keep (buyer-side check will still run)
        .mockResolvedValueOnce(null),   // OTHER_TXID — drop
    };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);
    await pruner.runPrune();
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(1);
    expect(bidsSvc.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', OTHER_TXID, 0, BUYER_A);
  });

  it('is re-entrancy safe — a second runPrune call while the first is still active is a no-op', async () => {
    let releaseFirst!: (rows: unknown[]) => void;
    const firstFromPromise = new Promise<unknown[]>((resolve) => { releaseFirst = resolve; });
    const fromMock = jest.fn()
      .mockReturnValueOnce(firstFromPromise)
      .mockReturnValueOnce(Promise.resolve([]));
    const drizzle = { db: { select: jest.fn().mockReturnValue({ from: fromMock }) } };
    const ord = { getCatsAtOutput: jest.fn() };
    const electrs = createElectrsMock();
    const bidsSvc = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, electrs as never, bidsSvc as never);

    const inflight = pruner.runPrune();
    await pruner.runPrune(); // guarded, no-op
    expect(fromMock).toHaveBeenCalledTimes(1);

    releaseFirst([]);
    await inflight;
    await pruner.runPrune();
    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});
