import { CacheService } from '../shared/cache/cache.service';
import { CatsService } from './cats.service';
import { GENESIS_ROW, GENESIS_DTO } from './__fixtures__/genesis-cat';

function createMockDrizzle(overrides: Record<string, any> = {}) {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue([[{ '1': 1 }], []]),
    ...overrides,
  };
  return { db: chainable };
}

function createMockSync(overrides: Partial<{ lastSuccessAt: Date | null; lastErrorAt: Date | null; lastError: string | null }> = {}) {
  return {
    getSyncHealth: () => ({
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      ...overrides,
    }),
  };
}

describe('CatsService', () => {
  describe('getHealth', () => {
    it('should return status ok with uptime', () => {
      const drizzle = createMockDrizzle();
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = service.getHealth();
      expect(result.status).toBe('ok');
      expect(result.uptimeSec).toBeGreaterThanOrEqual(0);
      expect(result.version).toBeDefined();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('getStatus', () => {
    it('should return totalCats, lastSyncedCatNumber, and proofOfCatWork', async () => {
      const drizzle = createMockDrizzle({
        from: jest.fn().mockResolvedValue([{ totalCats: 63732, lastSyncedCatNumber: 63731, proofOfCatWork: '5234876543' }]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getStatus();
      expect(result).toEqual({ totalCats: 63732, lastSyncedCatNumber: 63731, proofOfCatWork: 5234876543 });
    });

    it('should return -1 and 0 when no cats exist', async () => {
      const drizzle = createMockDrizzle({
        from: jest.fn().mockResolvedValue([{ totalCats: 0, lastSyncedCatNumber: null, proofOfCatWork: null }]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getStatus();
      expect(result).toEqual({ totalCats: 0, lastSyncedCatNumber: -1, proofOfCatWork: 0 });
    });
  });

  describe('getCatByNumber', () => {
    it('should return null when cat not found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatByNumber(999999);
      expect(result).toBeNull();
    });

    it('should map DB row to DTO', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatByNumber(0);
      expect(result).not.toBeNull();
      expect(result!.catNumber).toBe(0);
      expect(result!.txHash).toBe(GENESIS_ROW.txHash);
      expect(result!.mintedAt).toBe('2024-01-03T21:04:46.000Z');
      expect(result!.genesis).toBe(true);
    });
  });

  describe('getCatByTxHash', () => {
    it('should return null when cat not found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatByTxHash('0'.repeat(64));
      expect(result).toBeNull();
    });

    it('should return DTO when cat found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatByTxHash(GENESIS_ROW.txHash);
      expect(result).not.toBeNull();
      expect(result!.catNumber).toBe(0);
      expect(result!.blockHash).toBe(GENESIS_ROW.blockHash);
    });
  });

  describe('getCats', () => {
    it('should prime totals and batch-fetch missing cats from DB', async () => {
      const cache = new CacheService();
      cache.setTotals(1, 0); // pre-primed, so getCats skips prime query

      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]), // the IN-query returns genesis
      });
      const service = new CatsService(drizzle as any, cache, createMockSync() as any);

      const result = await service.getCats(12, 1);
      expect(result.total).toBe(1);
      expect(result.currentPage).toBe(1);
      expect(result.itemsPerPage).toBe(12);
      expect(result.cats).toHaveLength(1);
      expect(result.cats[0].catNumber).toBe(0);
      expect(cache.getCachedCat(0)).toBeDefined();
    });

    it('should prime totals via COUNT+MAX when cache is cold', async () => {
      const cache = new CacheService();
      // Cache is cold (lastSyncedCatNumber = -1)

      // First .from() call = prime query (resolves), second .from() call = IN-query (needs to chain).
      const drizzle = createMockDrizzle();
      let callCount = 0;
      drizzle.db.from = jest.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([{ totalCats: 1, lastSyncedCatNumber: 0 }]);
        }
        // second call: return chainable so .where() works
        return drizzle.db;
      }) as any;
      drizzle.db.where = jest.fn().mockResolvedValue([GENESIS_ROW]);

      const service = new CatsService(drizzle as any, cache, createMockSync() as any);

      const result = await service.getCats(12, 1);
      expect(result.total).toBe(1);
      expect(cache.getLastSyncedCatNumber()).toBe(0); // primed
    });

    it('should skip DB fetch when all cats already cached', async () => {
      const cache = new CacheService();
      cache.setTotals(1, 0);
      cache.setCachedCat({ ...GENESIS_DTO }); // genesis already in cache

      const whereMock = jest.fn();
      const drizzle = createMockDrizzle({ where: whereMock });
      const service = new CatsService(drizzle as any, cache, createMockSync() as any);

      const result = await service.getCats(12, 1);
      expect(result.cats).toHaveLength(1);
      expect(whereMock).not.toHaveBeenCalled(); // zero DB queries (no IN lookup needed)
    });
  });

  describe('getCatSvg', () => {
    it('should return null when cat not found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatSvg(999999);
      expect(result).toBeNull();
    });

    it('should return SVG string for existing cat', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([{
          txHash: GENESIS_ROW.txHash,
          weight: GENESIS_ROW.weight,
          fee: GENESIS_ROW.fee,
          blockHash: GENESIS_ROW.blockHash,
        }]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatSvg(0);
      expect(result).not.toBeNull();
      expect(result).toContain('<svg');
    });
  });

  describe('mapToDto', () => {
    it('should handle null mintedBy', async () => {
      const row = { ...GENESIS_ROW, mintedBy: null };
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([row]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatByNumber(0);
      expect(result!.mintedBy).toBeNull();
    });

    it('should map all 25 DTO fields', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getCatByNumber(0);
      expect(result).toEqual(GENESIS_DTO);
    });
  });

  describe('getExtendedHealth', () => {
    it('should return status ok when DB reachable and sync fresh', async () => {
      const drizzle = createMockDrizzle();
      const sync = createMockSync({ lastSuccessAt: new Date() });
      const service = new CatsService(drizzle as any, new CacheService(), sync as any);

      const result = await service.getExtendedHealth();
      expect(result.status).toBe('ok');
      expect(result.database.reachable).toBe(true);
      expect(result.database.error).toBeNull();
      expect(result.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.sync.stalled).toBe(false);
      expect(result.sync.lastSuccessAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.sync.secondsSinceLastSuccess).toBeLessThan(5);
    });

    it('should return status down when DB ping fails', async () => {
      const drizzle = createMockDrizzle({
        execute: jest.fn().mockRejectedValue(new Error('connection terminated: compute time exhausted')),
      });
      const sync = createMockSync({ lastSuccessAt: new Date() });
      const service = new CatsService(drizzle as any, new CacheService(), sync as any);

      const result = await service.getExtendedHealth();
      expect(result.status).toBe('down');
      expect(result.database.reachable).toBe(false);
      expect(result.database.error).toContain('compute time exhausted');
      expect(result.database.latencyMs).toBeNull();
    });

    it('should return status degraded when DB reachable but sync has never run', async () => {
      const drizzle = createMockDrizzle();
      const sync = createMockSync({ lastSuccessAt: null });
      const service = new CatsService(drizzle as any, new CacheService(), sync as any);

      const result = await service.getExtendedHealth();
      expect(result.status).toBe('degraded');
      expect(result.database.reachable).toBe(true);
      expect(result.sync.stalled).toBe(true);
      expect(result.sync.lastSuccessAt).toBeNull();
      expect(result.sync.secondsSinceLastSuccess).toBeNull();
    });

    it('should return status degraded when last sync is older than stall threshold', async () => {
      const drizzle = createMockDrizzle();
      const stale = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      const sync = createMockSync({ lastSuccessAt: stale });
      const service = new CatsService(drizzle as any, new CacheService(), sync as any);

      const result = await service.getExtendedHealth();
      expect(result.status).toBe('degraded');
      expect(result.sync.stalled).toBe(true);
      expect(result.sync.secondsSinceLastSuccess).toBeGreaterThan(300);
    });

    it('should surface last sync error without changing status when DB is up', async () => {
      const drizzle = createMockDrizzle();
      const sync = createMockSync({
        lastSuccessAt: new Date(),
        lastErrorAt: new Date(Date.now() - 30_000),
        lastError: 'ECONNRESET while fetching cat #42',
      });
      const service = new CatsService(drizzle as any, new CacheService(), sync as any);

      const result = await service.getExtendedHealth();
      expect(result.status).toBe('ok');
      expect(result.sync.lastError).toBe('ECONNRESET while fetching cat #42');
      expect(result.sync.lastErrorAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should truncate long DB error messages to 200 chars', async () => {
      const longMsg = 'x'.repeat(500);
      const drizzle = createMockDrizzle({
        execute: jest.fn().mockRejectedValue(new Error(longMsg)),
      });
      const service = new CatsService(drizzle as any, new CacheService(), createMockSync() as any);

      const result = await service.getExtendedHealth();
      expect(result.database.error!.length).toBe(200);
    });
  });
});
