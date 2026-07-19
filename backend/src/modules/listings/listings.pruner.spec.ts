import { ListingsPruner } from './listings.pruner';

const REAL_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
const OTHER_TXID = 'ff'.repeat(32);
const ORD_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-x',
  catNumber: 42,
  network: 'mainnet',
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
    const listings = { deleteByIdIfUnchanged: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(ord.getCatCurrentLocation).not.toHaveBeenCalled();
    expect(listings.deleteByIdIfUnchanged).not.toHaveBeenCalled();
  });

  it('keeps a listing whose current outpoint matches', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = {
      getCatCurrentLocation: jest.fn().mockResolvedValue({ txid: REAL_TXID, vout: 0, ordinalsAddress: ORD_ADDR }),
    };
    const listings = { deleteByIdIfUnchanged: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByIdIfUnchanged).not.toHaveBeenCalled();
  });

  it('drops a listing whose txid has drifted (cat has moved), guarded by id + signedAt', async () => {
    const r = row({ id: 'uuid-1', signedAt: 111 });
    const drizzle = drizzleWithRows([r]);
    const ord = {
      getCatCurrentLocation: jest.fn().mockResolvedValue({ txid: OTHER_TXID, vout: 0, ordinalsAddress: ORD_ADDR }),
    };
    const listings = { deleteByIdIfUnchanged: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByIdIfUnchanged).toHaveBeenCalledWith('uuid-1', 111);
  });

  it('drops a listing whose vout has drifted, guarded by id + signedAt', async () => {
    const r = row({ id: 'uuid-2', signedAt: 222 });
    const drizzle = drizzleWithRows([r]);
    const ord = {
      getCatCurrentLocation: jest.fn().mockResolvedValue({ txid: REAL_TXID, vout: 3, ordinalsAddress: ORD_ADDR }),
    };
    const listings = { deleteByIdIfUnchanged: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByIdIfUnchanged).toHaveBeenCalledWith('uuid-2', 222);
  });

  it('drops a listing when the cat is now free / unknown to ord (ord returns null)', async () => {
    const r = row({ id: 'uuid-3', signedAt: 333 });
    const drizzle = drizzleWithRows([r]);
    const ord = { getCatCurrentLocation: jest.fn().mockResolvedValue(null) };
    const listings = { deleteByIdIfUnchanged: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByIdIfUnchanged).toHaveBeenCalledWith('uuid-3', 333);
  });

  it('does NOT drop a listing when ord errors (transient — retry next tick)', async () => {
    const drizzle = drizzleWithRows([row()]);
    const ord = { getCatCurrentLocation: jest.fn().mockRejectedValue(new Error('ord flake')) };
    const listings = { deleteByIdIfUnchanged: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByIdIfUnchanged).not.toHaveBeenCalled();
  });

  it('processes multiple listings independently — ord flake on one does not abort the rest', async () => {
    const drizzle = drizzleWithRows([
      row({ id: 'uuid-a', catNumber: 1, signedAt: 1_111, catTxid: 'aa'.repeat(32) }),
      row({ id: 'uuid-b', catNumber: 2, signedAt: 2_222, catTxid: 'bb'.repeat(32) }),
      row({ id: 'uuid-c', catNumber: 3, signedAt: 3_333, catTxid: 'cc'.repeat(32) }),
    ]);
    const ord = {
      getCatCurrentLocation: jest.fn()
        .mockResolvedValueOnce({ txid: 'aa'.repeat(32), vout: 0, ordinalsAddress: ORD_ADDR }) // keep
        .mockRejectedValueOnce(new Error('flake'))                                              // skip
        .mockResolvedValueOnce({ txid: OTHER_TXID, vout: 0, ordinalsAddress: ORD_ADDR }),      // drop
    };
    const listings = { deleteByIdIfUnchanged: jest.fn().mockResolvedValue(undefined) };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);
    await pruner.runPrune();
    expect(listings.deleteByIdIfUnchanged).toHaveBeenCalledTimes(1);
    expect(listings.deleteByIdIfUnchanged).toHaveBeenCalledWith('uuid-c', 3_333);
  });

  it('is re-entrancy safe — a second runPrune call while the first is still active is a no-op', async () => {
    // Make the first select block until we release it, so the two runPrune
    // calls truly overlap.
    let releaseFirst!: (rows: unknown[]) => void;
    const firstFromPromise = new Promise<unknown[]>((resolve) => { releaseFirst = resolve; });
    const fromMock = jest.fn()
      .mockReturnValueOnce(firstFromPromise) // first call blocks
      .mockReturnValueOnce(Promise.resolve([])); // would-be second (should never fire)
    const drizzle = { db: { select: jest.fn().mockReturnValue({ from: fromMock }) } };
    const ord = { getCatCurrentLocation: jest.fn() };
    const listings = { deleteByIdIfUnchanged: jest.fn() };
    const pruner = new ListingsPruner(drizzle as never, ord as never, listings as never);

    const inflight = pruner.runPrune();
    // Second tick fires while `inflight` is still running; guard should skip.
    await pruner.runPrune();
    expect(fromMock).toHaveBeenCalledTimes(1);

    releaseFirst([]);
    await inflight;
    // After the first run completes the guard clears and a subsequent
    // run can start again.
    await pruner.runPrune();
    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});
