import { ListingsPruner } from './listings.pruner';

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const OTHER_TXID = 'ff'.repeat(32);
const ORD_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-x',
  catNumber: 42,
  askSats: 21_000,
  payTo: 'bc1q-somewhere',
  catTxid: REAL_TXID,
  catVout: 0,
  ordinalsAddress: ORD_ADDR,
  signedAt: 1_784_400_000,
  signature: 'sig',
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

describe('ListingsPruner.runPrune', () => {

  it('is a no-op when the table is empty', async () => {
    const drizzle = drizzleWithRows([]);
    const ord = { getCatCurrentLocation: jest.fn() };
    const listings = { deleteByCatNumber: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(ord.getCatCurrentLocation).not.toHaveBeenCalled();
    expect(listings.deleteByCatNumber).not.toHaveBeenCalled();
  });

  it('keeps a listing whose current outpoint matches', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = {
      getCatCurrentLocation: jest.fn().mockResolvedValue({ txid: REAL_TXID, vout: 0, ordinalsAddress: ORD_ADDR }),
    };
    const listings = { deleteByCatNumber: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByCatNumber).not.toHaveBeenCalled();
  });

  it('drops a listing whose txid has drifted (cat has moved)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = {
      getCatCurrentLocation: jest.fn().mockResolvedValue({ txid: OTHER_TXID, vout: 0, ordinalsAddress: ORD_ADDR }),
    };
    const listings = { deleteByCatNumber: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByCatNumber).toHaveBeenCalledWith(42);
  });

  it('drops a listing whose vout has drifted', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = {
      getCatCurrentLocation: jest.fn().mockResolvedValue({ txid: REAL_TXID, vout: 3, ordinalsAddress: ORD_ADDR }),
    };
    const listings = { deleteByCatNumber: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByCatNumber).toHaveBeenCalledWith(42);
  });

  it('drops a listing when the cat is now free / unknown to ord (ord returns null)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatCurrentLocation: jest.fn().mockResolvedValue(null) };
    const listings = { deleteByCatNumber: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByCatNumber).toHaveBeenCalledWith(42);
  });

  it('does NOT drop a listing when ord errors (transient — retry next tick)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatCurrentLocation: jest.fn().mockRejectedValue(new Error('ord flake')) };
    const listings = { deleteByCatNumber: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByCatNumber).not.toHaveBeenCalled();
  });

  it('processes multiple listings independently — ord flake on one does not abort the rest', async () => {
    const drizzle = drizzleWithRows([
      row({ catNumber: 1, catTxid: 'aa'.repeat(32) }),
      row({ catNumber: 2, catTxid: 'bb'.repeat(32) }),
      row({ catNumber: 3, catTxid: 'cc'.repeat(32) }),
    ]);
    const ord = {
      getCatCurrentLocation: jest.fn()
        .mockResolvedValueOnce({ txid: 'aa'.repeat(32), vout: 0, ordinalsAddress: ORD_ADDR }) // keep
        .mockRejectedValueOnce(new Error('flake'))                                              // skip
        .mockResolvedValueOnce({ txid: OTHER_TXID, vout: 0, ordinalsAddress: ORD_ADDR }),      // drop
    };
    const listings = { deleteByCatNumber: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByCatNumber).toHaveBeenCalledTimes(1);
    expect(listings.deleteByCatNumber).toHaveBeenCalledWith(3);
  });
});
