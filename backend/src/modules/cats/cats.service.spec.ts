import { CatsService } from './cats.service';

// Genesis cat test data
const GENESIS_ROW = {
  id: 'uuid-1',
  catNumber: 0,
  txHash: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892',
  blockHash: '000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7',
  blockHeight: 824205,
  mintedAt: new Date('2024-01-03T21:04:46.000Z'),
  mintedBy: 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh',
  fee: 40834,
  weight: 705,
  feeRate: 231.67,
  sat: 596964966600565,
  value: 546,
  category: 'sub1k',
  genesis: true,
  catColors: ['#000000'],
  male: true,
  female: false,
  designIndex: 0,
  designPose: 'standing',
  designExpression: 'smile',
  designPattern: 'solid',
  designFacing: 'left',
  laserEyes: null,
  background: null,
  backgroundColors: null,
  crown: null,
  glasses: null,
  glassesColors: null,
};

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
  // Make select() return the chainable, but also make the chainable itself thenable
  // so that `await db.select().from().where()` resolves to the mock data
  return { db: chainable };
}

describe('CatsService', () => {
  describe('getStatus', () => {
    it('should return totalCats and lastSyncedCatNumber', async () => {
      const drizzle = createMockDrizzle({
        from: jest.fn().mockResolvedValue([{ totalCats: 63732, lastSyncedCatNumber: 63731 }]),
      });
      const service = new CatsService(drizzle as any);

      const result = await service.getStatus();
      expect(result).toEqual({ totalCats: 63732, lastSyncedCatNumber: 63731 });
    });

    it('should return -1 when no cats exist', async () => {
      const drizzle = createMockDrizzle({
        from: jest.fn().mockResolvedValue([{ totalCats: 0, lastSyncedCatNumber: null }]),
      });
      const service = new CatsService(drizzle as any);

      const result = await service.getStatus();
      expect(result).toEqual({ totalCats: 0, lastSyncedCatNumber: -1 });
    });
  });

  describe('getCatByNumber', () => {
    it('should return null when cat not found', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([]),
      });
      const service = new CatsService(drizzle as any);

      const result = await service.getCatByNumber(999999);
      expect(result).toBeNull();
    });

    it('should map DB row to DTO', async () => {
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([GENESIS_ROW]),
      });
      const service = new CatsService(drizzle as any);

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
      const service = new CatsService(drizzle as any);

      const result = await service.getCatByTxHash('0'.repeat(64));
      expect(result).toBeNull();
    });
  });

  describe('mapToDto', () => {
    it('should handle null mintedAt', async () => {
      const row = { ...GENESIS_ROW, mintedAt: null };
      const drizzle = createMockDrizzle({
        where: jest.fn().mockResolvedValue([row]),
      });
      const service = new CatsService(drizzle as any);

      const result = await service.getCatByNumber(0);
      expect(result!.mintedAt).toBeNull();
    });
  });
});
