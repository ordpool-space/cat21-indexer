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
      getCat: jest.fn().mockImplementation((n: number) =>
        Promise.resolve({
          id: `hash${n}i0`,
          number: n,
          address: 'bc1p...',
          sat: 100000 + n,
          fee: 1000,
          height: 800000 + n,
          timestamp: 1700000000 + n,
          value: 546,
          weight: 500,
        }),
      ),
      getBlockHash: jest.fn().mockImplementation((h: number) =>
        Promise.resolve('0'.repeat(64)),
      ),
    };

    const service = new SyncService(drizzle as any, ordClient as any);
    return { service, drizzle, ordClient, insertMock };
  }

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

  it('should sync missing cats', async () => {
    const { service, ordClient, insertMock } = createMocks(2, 5);

    await service.sync();

    // Should fetch cats 3, 4, 5
    expect(ordClient.getCat).toHaveBeenCalledWith(3);
    expect(ordClient.getCat).toHaveBeenCalledWith(4);
    expect(ordClient.getCat).toHaveBeenCalledWith(5);
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

  it('should prevent concurrent syncs', async () => {
    const { service, ordClient } = createMocks(0, 5);

    // Make getCat slow so sync takes time
    ordClient.getCat.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        id: 'xi0', number: 1, address: null, sat: null,
        fee: 100, height: 800000, timestamp: 1700000000,
        value: null, weight: 500,
      }), 50)),
    );

    // Start two syncs simultaneously
    const sync1 = service.sync();
    const sync2 = service.sync();

    await Promise.all([sync1, sync2]);

    // getLatestCatNumber should only be called once (second sync skipped)
    expect(ordClient.getLatestCatNumber).toHaveBeenCalledTimes(1);
  });

  it('should handle partial batch failures gracefully', async () => {
    const { service, ordClient, insertMock } = createMocks(-1, 3);

    // Cat 1 fails, cats 0 and 2 succeed
    ordClient.getCat
      .mockResolvedValueOnce({
        id: 'h0i0', number: 0, address: null, sat: null,
        fee: 100, height: 800000, timestamp: 1700000000,
        value: null, weight: 500,
      })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        id: 'h2i0', number: 2, address: null, sat: null,
        fee: 100, height: 800002, timestamp: 1700000002,
        value: null, weight: 500,
      })
      .mockResolvedValueOnce({
        id: 'h3i0', number: 3, address: null, sat: null,
        fee: 100, height: 800003, timestamp: 1700000003,
        value: null, weight: 500,
      });

    await service.sync();

    // Should still insert the cats that succeeded
    expect(insertMock).toHaveBeenCalled();
  });

  it('should handle sync errors without crashing', async () => {
    const { service, ordClient } = createMocks(0, 5);
    ordClient.getLatestCatNumber.mockRejectedValue(new Error('network down'));

    // Should not throw
    await service.sync();
  });

  it('should fetch block hashes for unique heights', async () => {
    const { service, ordClient } = createMocks(-1, 1);

    ordClient.getCat
      .mockResolvedValueOnce({
        id: 'h0i0', number: 0, address: null, sat: null,
        fee: 100, height: 800000, timestamp: 1700000000,
        value: null, weight: 500,
      })
      .mockResolvedValueOnce({
        id: 'h1i0', number: 1, address: null, sat: null,
        fee: 100, height: 800000, timestamp: 1700000000,
        value: null, weight: 500,
      });

    await service.sync();

    // Same block height, should only fetch once
    expect(ordClient.getBlockHash).toHaveBeenCalledWith(800000);
    expect(ordClient.getBlockHash).toHaveBeenCalledTimes(1);
  });
});
