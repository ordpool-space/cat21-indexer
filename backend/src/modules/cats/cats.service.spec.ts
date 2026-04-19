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
    ...overrides,
  };
  return { db: chainable };
}

describe('CatsService', () => {
  describe('getHealth', () => {
    it('should return status ok with uptime', () => {
      const drizzle = createMockDrizzle();
      const service = new CatsService(drizzle as any, new CacheService());

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
      const service = new CatsService(drizzle as any, new CacheService());

      const result = await service.getStatus();
      expect(result).toEqual({ totalCats: 63732, lastSyncedCatNumber: 63731, proofOfCatWork: 5234876543 });
    });

    it('should return -1 and 0 when no cats exist', async () => {
      const drizzle = createMockDrizzle({
        from: jest.fn().mockResolvedValue([{ totalCats: 0, lastSyncedCatNumber: null, proofOfCatWork: null }]),
      });
      const service = new CatsService(drizzle as any, new CacheService());

      const result = await service.getStatus();
      expect(result).toEqual({ totalCats: 0, lastSyncedCatNumber: -1, proofOfCatWork: 0 });
    });
  });

  describe('getCatByNumber', () => {
    it('should return null when cat not found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([]),
      });
      const service = new CatsService(drizzle as any, new CacheService());

      const result = await service.getCatByNumber(999999);
      expect(result).toBeNull();
    });

    it('should map DB row to DTO', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any, new CacheService());

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
      const service = new CatsService(drizzle as any, new CacheService());

      const result = await service.getCatByTxHash('0'.repeat(64));
      expect(result).toBeNull();
    });

    it('should return DTO when cat found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any, new CacheService());

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
      const service = new CatsService(drizzle as any, cache);

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

      const service = new CatsService(drizzle as any, cache);

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
      const service = new CatsService(drizzle as any, cache);

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
      const service = new CatsService(drizzle as any, new CacheService());

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
      const service = new CatsService(drizzle as any, new CacheService());

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
      const service = new CatsService(drizzle as any, new CacheService());

      const result = await service.getCatByNumber(0);
      expect(result!.mintedBy).toBeNull();
    });

    it('should map all 25 DTO fields', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any, new CacheService());

      const result = await service.getCatByNumber(0);
      expect(result).toEqual(GENESIS_DTO);
    });
  });
});
