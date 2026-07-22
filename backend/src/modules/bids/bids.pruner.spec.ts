import { BidsPruner } from './bids.pruner';

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const BUYER_A = 'bc1p-buyer-a';
const BUYER_B = 'bc1p-buyer-b';

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

describe('BidsPruner.runPrune', () => {

  it('is a no-op when the table is empty', async () => {
    const drizzle = drizzleWithRows([]);
    const ord = { getCatsAtOutput: jest.fn() };
    const bids = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(ord.getCatsAtOutput).not.toHaveBeenCalled();
    expect(bids.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });

  it('keeps a bid whose UTXO still carries the signed cats bundle', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42]) };
    const bids = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(bids.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });

  it('drops a bid when the UTXO no longer holds cats (spent / unknown)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue(null) };
    const bids = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', REAL_TXID, 0, BUYER_A);
  });

  it('drops a bid when the UTXO carries an empty cats array', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([]) };
    const bids = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', REAL_TXID, 0, BUYER_A);
  });

  it('drops a bid when the live cats bundle differs from the signed one (extra cat)', async () => {
    const drizzle = drizzleWithRows([row({ catsOnUtxo: [42] })]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue([42, 99]) };
    const bids = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(1);
  });

  it('drops all bids on a stale UTXO in ONE ord lookup (batched by outpoint)', async () => {
    // Two bids on the same UTXO from different buyers.
    const drizzle = drizzleWithRows([
      row({ id: 'a', buyerOrdinalsAddress: BUYER_A }),
      row({ id: 'b', buyerOrdinalsAddress: BUYER_B }),
    ]);
    const ord = { getCatsAtOutput: jest.fn().mockResolvedValue(null) };
    const bids = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    // Only ONE ord lookup shared by both bids.
    expect(ord.getCatsAtOutput).toHaveBeenCalledTimes(1);
    // Both bids dropped.
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(2);
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', REAL_TXID, 0, BUYER_A);
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', REAL_TXID, 0, BUYER_B);
  });

  it('does NOT drop a bid when the ord lookup errors (transient — retry next tick)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatsAtOutput: jest.fn().mockRejectedValue(new Error('ord flake')) };
    const bids = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(bids.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
  });

  it('processes multiple UTXOs independently — an ord flake on one does not abort the rest', async () => {
    const OTHER_TXID = 'bb'.repeat(32);
    const drizzle = drizzleWithRows([
      row({ id: 'a', catTxid: REAL_TXID }),
      row({ id: 'b', catTxid: OTHER_TXID }),
    ]);
    const ord = {
      getCatsAtOutput: jest.fn()
        .mockResolvedValueOnce([42])            // REAL_TXID — keep
        .mockResolvedValueOnce(null),            // OTHER_TXID — drop
    };
    const bids = { deleteByOutpointAndBuyer: jest.fn().mockResolvedValue(undefined) };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);
    await pruner.runPrune();
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledTimes(1);
    expect(bids.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', OTHER_TXID, 0, BUYER_A);
  });

  it('is re-entrancy safe — a second runPrune call while the first is still active is a no-op', async () => {
    let releaseFirst!: (rows: unknown[]) => void;
    const firstFromPromise = new Promise<unknown[]>((resolve) => { releaseFirst = resolve; });
    const fromMock = jest.fn()
      .mockReturnValueOnce(firstFromPromise)
      .mockReturnValueOnce(Promise.resolve([]));
    const drizzle = { db: { select: jest.fn().mockReturnValue({ from: fromMock }) } };
    const ord = { getCatsAtOutput: jest.fn() };
    const bids = { deleteByOutpointAndBuyer: jest.fn() };
    const pruner = new BidsPruner(drizzle as never, ord as never, bids as never);

    const inflight = pruner.runPrune();
    await pruner.runPrune(); // guarded, no-op
    expect(fromMock).toHaveBeenCalledTimes(1);

    releaseFirst([]);
    await inflight;
    await pruner.runPrune();
    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});
