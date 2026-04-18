import { CacheService } from './cache.service';
import { CatDto } from '../../cats/dto/cat.dto';

function makeCatDto(catNumber: number, txHash?: string): CatDto {
  return {
    id: `uuid-${catNumber}`,
    catNumber,
    txHash: txHash ?? `tx-${catNumber}`,
    blockHash: `block-${catNumber}`,
    blockHeight: 824205 + catNumber,
    mintedAt: '2024-01-03T21:04:46.000Z',
    mintedBy: 'bc1p...',
    fee: 40834,
    weight: 705,
    size: 258,
    feeRate: 231.68,
    sat: 1924083497071885 + catNumber,
    value: 546,
    category: 'sub1k',
    genesis: catNumber === 0,
    catColors: ['#4acf16'],
    male: true,
    female: false,
    designIndex: 0,
    designPose: 'standing',
    designExpression: 'smile',
    designPattern: 'solid',
    designFacing: 'left',
    laserEyes: 'None',
    background: 'None',
    backgroundColors: [],
    crown: 'None',
    glasses: 'None',
    glassesColors: [],
  };
}

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  // --- Cat caching ---

  it('should cache and retrieve a cat by number', () => {
    const cat = makeCatDto(42);
    cache.setCachedCat(cat);
    expect(cache.getCachedCat(42)).toBe(cat);
  });

  it('should return undefined for uncached cat', () => {
    expect(cache.getCachedCat(999)).toBeUndefined();
  });

  it('should cache and retrieve cat number by txHash', () => {
    const cat = makeCatDto(42, 'abc123');
    cache.setCachedCat(cat);
    expect(cache.getCachedCatNumberByTxHash('abc123')).toBe(42);
  });

  it('should clean up txHash index on eviction', () => {
    // Create cache with capacity 2 (override via accessing private)
    const smallCache = new CacheService();
    (smallCache as any).catsByNumber.setMaxSize(2);

    const cat1 = makeCatDto(1, 'tx-1');
    const cat2 = makeCatDto(2, 'tx-2');
    const cat3 = makeCatDto(3, 'tx-3');

    smallCache.setCachedCat(cat1);
    smallCache.setCachedCat(cat2);
    smallCache.setCachedCat(cat3); // evicts cat1

    expect(smallCache.getCachedCatNumberByTxHash('tx-1')).toBeUndefined();
    expect(smallCache.getCachedCatNumberByTxHash('tx-2')).toBe(2);
    expect(smallCache.getCachedCatNumberByTxHash('tx-3')).toBe(3);
  });

  // --- Pagination caching ---

  it('should cache first pages as pinned', () => {
    cache.setTotals(1000, 999);
    const numbers = [999, 998, 997];
    cache.setCachedCatNumbers(48, 1, numbers);
    expect(cache.getCachedCatNumbers(48, 1)).toBe(numbers);
  });

  it('should cache last pages as pinned', () => {
    cache.setTotals(1000, 999);
    const numbers = [2, 1, 0];
    const lastPage = Math.ceil(1000 / 48); // 21
    cache.setCachedCatNumbers(48, lastPage, numbers);
    expect(cache.getCachedCatNumbers(48, lastPage)).toBe(numbers);
  });

  it('should cache middle pages in LRU', () => {
    cache.setTotals(10000, 9999);
    const numbers = [500, 499, 498];
    cache.setCachedCatNumbers(48, 10, numbers);
    expect(cache.getCachedCatNumbers(48, 10)).toBe(numbers);
  });

  it('should return undefined for uncached page', () => {
    expect(cache.getCachedCatNumbers(48, 5)).toBeUndefined();
  });

  // --- Totals ---

  it('should return cached totals', () => {
    cache.setTotals(63732, 63731);
    expect(cache.getTotalCatCount()).toBe(63732);
    expect(cache.getLastSyncedCatNumber()).toBe(63731);
  });

  it('should start with zero totals', () => {
    expect(cache.getTotalCatCount()).toBe(0);
    expect(cache.getLastSyncedCatNumber()).toBe(-1);
  });

  // --- Sync notification ---

  it('should update totals on sync', () => {
    cache.setTotals(100, 99);
    cache.onNewCatsSynced(109);
    expect(cache.getTotalCatCount()).toBe(110);
    expect(cache.getLastSyncedCatNumber()).toBe(109);
  });

  it('should clear pinned first pages on sync', () => {
    cache.setTotals(1000, 999);
    cache.setCachedCatNumbers(48, 1, [999, 998, 997]);
    expect(cache.getCachedCatNumbers(48, 1)).toBeDefined();

    cache.onNewCatsSynced(1009);
    expect(cache.getCachedCatNumbers(48, 1)).toBeUndefined();
  });

  it('should NOT clear pinned last pages on sync', () => {
    cache.setTotals(1000, 999);
    const lastPage = Math.ceil(1000 / 48);
    const genesisPage = [2, 1, 0];
    cache.setCachedCatNumbers(48, lastPage, genesisPage);

    cache.onNewCatsSynced(1009);
    expect(cache.getCachedCatNumbers(48, lastPage)).toBe(genesisPage);
  });

  it('should NOT clear individual cat cache on sync', () => {
    const cat = makeCatDto(42);
    cache.setCachedCat(cat);
    cache.onNewCatsSynced(100);
    expect(cache.getCachedCat(42)).toBe(cat);
  });

  // --- Stats ---

  it('should report cache stats', () => {
    cache.setCachedCat(makeCatDto(1));
    cache.setCachedCat(makeCatDto(2));
    cache.setTotals(1000, 999);

    const stats = cache.getStats();
    expect(stats.cats).toBe(2);
    expect(stats.txHashIndex).toBe(2);
    expect(stats.totalCatCount).toBe(1000);
    expect(stats.lastSyncedCatNumber).toBe(999);
  });
});
