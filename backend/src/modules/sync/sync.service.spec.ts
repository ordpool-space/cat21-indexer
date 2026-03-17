import { deriveCategory, SyncService } from './sync.service';

describe('deriveCategory', () => {
  it('should return sub1k for cats 0-999', () => {
    expect(deriveCategory(0)).toBe('sub1k');
    expect(deriveCategory(999)).toBe('sub1k');
  });

  it('should return sub10k for cats 1000-9999', () => {
    expect(deriveCategory(1000)).toBe('sub10k');
    expect(deriveCategory(9999)).toBe('sub10k');
  });

  it('should return sub50k for cats 10000-49999', () => {
    expect(deriveCategory(10000)).toBe('sub50k');
    expect(deriveCategory(49999)).toBe('sub50k');
  });

  it('should return sub100k for cats 50000-99999', () => {
    expect(deriveCategory(50000)).toBe('sub100k');
    expect(deriveCategory(99999)).toBe('sub100k');
  });

  it('should return sub250k for cats 100000-249999', () => {
    expect(deriveCategory(100000)).toBe('sub250k');
    expect(deriveCategory(249999)).toBe('sub250k');
  });

  it('should return sub500k for cats 250000-499999', () => {
    expect(deriveCategory(250000)).toBe('sub500k');
    expect(deriveCategory(499999)).toBe('sub500k');
  });

  it('should return sub1M for cats 500000-999999', () => {
    expect(deriveCategory(500000)).toBe('sub1M');
    expect(deriveCategory(999999)).toBe('sub1M');
  });

  it('should return empty string for cats 1000000+', () => {
    expect(deriveCategory(1000000)).toBe('');
    expect(deriveCategory(9999999)).toBe('');
  });
});

describe('SyncService', () => {
  function makeCat(n: number, height = 800000 + n) {
    return {
      id: `hash${n}i0`,
      number: n,
      address: 'bc1p...',
      sat: 100000 + n,
      fee: 1000,
      height,
      timestamp: 1700000000 + n,
      value: 546,
      weight: 500,
    };
  }

  function createMocks(localMax: number | null = null, remoteMax = 5) {
    const insertMock = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      }),
    });

    const drizzle = {
      db: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockResolvedValue([{ maxCatNumber: localMax }]),
        }),
        insert: insertMock,
      },
    };

    const ordClient = {
      getLatestCatNumber: jest.fn().mockResolvedValue(remoteMax),
      getCat: jest.fn().mockImplementation((n: number) => Promise.resolve(makeCat(n))),
      getBlockHash: jest.fn().mockImplementation(() => Promise.resolve('0'.repeat(64))),
    };

    const service = new SyncService(drizzle as any, ordClient as any);
    return { service, drizzle, ordClient, insertMock };
  }

  // --- Basic sync algorithm ---

  it('should skip sync when already up to date', async () => {
    const { service, ordClient, insertMock } = createMocks(10, 10);
    await service.sync();
    expect(ordClient.getLatestCatNumber).toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('should skip sync when remote is behind local', async () => {
    const { service, insertMock } = createMocks(10, 5);
    await service.sync();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('should sync missing cats from localMax+1 to remoteMax', async () => {
    const { service, ordClient, insertMock } = createMocks(2, 5);
    await service.sync();

    expect(ordClient.getCat).toHaveBeenCalledWith(3);
    expect(ordClient.getCat).toHaveBeenCalledWith(4);
    expect(ordClient.getCat).toHaveBeenCalledWith(5);
    expect(ordClient.getCat).not.toHaveBeenCalledWith(2);
    expect(insertMock).toHaveBeenCalled();
  });

  it('should sync from 0 when database is empty', async () => {
    const { service, ordClient, insertMock } = createMocks(null, 2);
    await service.sync();

    expect(ordClient.getCat).toHaveBeenCalledWith(0);
    expect(ordClient.getCat).toHaveBeenCalledWith(1);
    expect(ordClient.getCat).toHaveBeenCalledWith(2);
    expect(insertMock).toHaveBeenCalled();
  });

  it('should handle multi-batch sync (more cats than BATCH_SIZE)', async () => {
    const { service, ordClient, insertMock } = createMocks(-1, 24);
    await service.sync();

    // 25 cats (0-24), BATCH_SIZE=10 → 3 batches: [0-9], [10-19], [20-24]
    expect(ordClient.getCat).toHaveBeenCalledTimes(25);
    expect(ordClient.getCat).toHaveBeenCalledWith(0);
    expect(ordClient.getCat).toHaveBeenCalledWith(10);
    expect(ordClient.getCat).toHaveBeenCalledWith(20);
    expect(ordClient.getCat).toHaveBeenCalledWith(24);
    // Multiple insert calls (one per batch)
    expect(insertMock).toHaveBeenCalledTimes(3);
  });

  // --- Block hash dedup ---

  it('should fetch block hashes for unique heights only', async () => {
    const { service, ordClient } = createMocks(-1, 1);

    // Both cats in same block
    ordClient.getCat
      .mockResolvedValueOnce(makeCat(0, 800000))
      .mockResolvedValueOnce(makeCat(1, 800000));

    await service.sync();

    expect(ordClient.getBlockHash).toHaveBeenCalledWith(800000);
    expect(ordClient.getBlockHash).toHaveBeenCalledTimes(1);
  });

  it('should fetch separate block hashes for different heights', async () => {
    const { service, ordClient } = createMocks(-1, 1);

    ordClient.getCat
      .mockResolvedValueOnce(makeCat(0, 800000))
      .mockResolvedValueOnce(makeCat(1, 800001));

    await service.sync();

    expect(ordClient.getBlockHash).toHaveBeenCalledWith(800000);
    expect(ordClient.getBlockHash).toHaveBeenCalledWith(800001);
    expect(ordClient.getBlockHash).toHaveBeenCalledTimes(2);
  });

  // --- Concurrency ---

  it('should prevent concurrent syncs', async () => {
    const { service, ordClient } = createMocks(0, 5);
    ordClient.getCat.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeCat(1)), 50)),
    );

    const sync1 = service.sync();
    const sync2 = service.sync();
    await Promise.all([sync1, sync2]);

    expect(ordClient.getLatestCatNumber).toHaveBeenCalledTimes(1);
  });

  // --- Error handling & recovery ---

  it('should handle partial batch failures gracefully (some cats fail)', async () => {
    const { service, ordClient, insertMock } = createMocks(-1, 2);

    ordClient.getCat
      .mockResolvedValueOnce(makeCat(0))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(makeCat(2));

    await service.sync();

    // Should still insert the 2 cats that succeeded
    expect(insertMock).toHaveBeenCalled();
    const insertedValues = insertMock.mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues).toHaveLength(2);
  });

  it('should break when entire batch fails (all cats return null or error)', async () => {
    const { service, ordClient, insertMock } = createMocks(-1, 2);

    // All 3 cats fail
    ordClient.getCat
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'));

    await service.sync();

    // No inserts because details.length === 0 → break
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('should not throw when getLatestCatNumber fails (ord completely down)', async () => {
    const { service, ordClient } = createMocks(0, 5);
    ordClient.getLatestCatNumber.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.sync()).resolves.toBeUndefined();
  });

  it('should not throw when getBlockHash fails mid-sync', async () => {
    const { service, ordClient } = createMocks(-1, 0);
    ordClient.getBlockHash.mockRejectedValue(new Error('500 Internal Server Error'));

    await expect(service.sync()).resolves.toBeUndefined();
  });

  it('should reset syncing flag after error (allows retry on next tick)', async () => {
    const { service, ordClient } = createMocks(0, 5);
    ordClient.getLatestCatNumber.mockRejectedValue(new Error('network down'));

    await service.sync();

    // syncing flag should be reset — second sync should proceed
    ordClient.getLatestCatNumber.mockResolvedValue(0); // up to date
    await service.sync();

    // If flag wasn't reset, second call would skip and getLatestCatNumber would be called only once
    expect(ordClient.getLatestCatNumber).toHaveBeenCalledTimes(2);
  });

  it('should clear blockHashCache after error (no stale data)', async () => {
    const { service, ordClient } = createMocks(-1, 0);

    // First sync: succeeds, caches block hash
    await service.sync();
    expect(ordClient.getBlockHash).toHaveBeenCalledTimes(1);

    // Second sync: if cache was cleared, getBlockHash will be called again
    ordClient.getLatestCatNumber.mockResolvedValue(0);
    ordClient.getCat.mockResolvedValue(makeCat(0));

    // Simulate fresh DB state
    (service as any).drizzle.db.select.mockReturnValue({
      from: jest.fn().mockResolvedValue([{ maxCatNumber: -1 }]),
    });

    await service.sync();

    // Block hash fetched again because cache was cleared after first sync
    expect(ordClient.getBlockHash).toHaveBeenCalledTimes(2);
  });

  it('should recover after ord goes down and comes back', async () => {
    const { service, ordClient, insertMock } = createMocks(0, 5);

    // Tick 1: ord is down
    ordClient.getLatestCatNumber.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await service.sync();
    expect(insertMock).not.toHaveBeenCalled();

    // Tick 2: ord is back, 2 new cats
    ordClient.getLatestCatNumber.mockResolvedValueOnce(2);
    ordClient.getCat
      .mockResolvedValueOnce(makeCat(1))
      .mockResolvedValueOnce(makeCat(2));

    await service.sync();
    expect(insertMock).toHaveBeenCalled();
  });

  it('should handle getLatestCatNumber returning -1 (ord has no cats)', async () => {
    const { service, insertMock } = createMocks(null, -1);
    // remoteMax = -1, localMax = -1 → nothing to sync
    await service.sync();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
