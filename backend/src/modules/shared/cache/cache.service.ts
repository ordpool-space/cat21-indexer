import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CatDto } from '../../cats/dto/cat.dto';
import { LruMap } from './lru-map';

const PINNED_PAGES = 3;
const DEFAULT_CAT_CAPACITY = 10_000;
const DEFAULT_PAGINATION_CAPACITY = 200;
const MEMORY_CHECK_INTERVAL = 60_000;
const CONTAINER_LIMIT = 512 * 1024 * 1024; // 512 MB (Koyeb ECO eMicro)
const MEMORY_TARGET_RATIO = 0.75;
const DANGER_HEADROOM = 20 * 1024 * 1024; // 20 MB
const GROWTH_HEADROOM = 100 * 1024 * 1024; // 100 MB

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  // Individual cats (LRU, evicts oldest on overflow)
  private readonly catsByNumber: LruMap<number, CatDto>;
  private readonly txHashToNumber = new Map<string, number>();

  // Pagination results (LRU for middle pages)
  private readonly paginationCache: LruMap<string, number[]>;

  // Pinned pages (never evicted, cleared on sync for first pages)
  private readonly pinnedFirstPages = new Map<string, number[]>();
  private readonly pinnedLastPages = new Map<string, number[]>();

  // Cached totals (updated by sync)
  private totalCatCount = 0;
  private lastSyncedCatNumber = -1;

  private memoryCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.catsByNumber = new LruMap<number, CatDto>(DEFAULT_CAT_CAPACITY, {
      onEvict: (_key, cat) => this.txHashToNumber.delete(cat.txHash),
    });
    this.paginationCache = new LruMap<string, number[]>(
      DEFAULT_PAGINATION_CAPACITY,
    );
  }

  onModuleInit() {
    this.memoryCheckTimer = setInterval(
      () => this.adjustCacheSizes(),
      MEMORY_CHECK_INTERVAL,
    );
    this.logger.log(
      `Cache initialized (cats: ${DEFAULT_CAT_CAPACITY}, pagination: ${DEFAULT_PAGINATION_CAPACITY})`,
    );
  }

  onModuleDestroy() {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
    }
  }

  // --- Cat lookups ---

  getCachedCat(catNumber: number): CatDto | undefined {
    return this.catsByNumber.get(catNumber);
  }

  getCachedCatNumberByTxHash(txHash: string): number | undefined {
    return this.txHashToNumber.get(txHash);
  }

  setCachedCat(cat: CatDto): void {
    this.catsByNumber.set(cat.catNumber, cat);
    this.txHashToNumber.set(cat.txHash, cat.catNumber);
  }

  // --- Pagination ---

  getCachedCatNumbers(ipp: number, page: number): number[] | undefined {
    const key = `${ipp}:${page}`;

    // Check pinned first
    const pinned =
      this.pinnedFirstPages.get(key) ?? this.pinnedLastPages.get(key);
    if (pinned) return pinned;

    // Check LRU
    return this.paginationCache.get(key);
  }

  setCachedCatNumbers(
    ipp: number,
    page: number,
    catNumbers: number[],
  ): void {
    const key = `${ipp}:${page}`;
    const totalPages = Math.ceil(this.totalCatCount / ipp);

    if (page <= PINNED_PAGES) {
      // First pages (newest cats, invalidated on sync)
      this.pinnedFirstPages.set(key, catNumbers);
    } else if (page > totalPages - PINNED_PAGES) {
      // Last pages (genesis cats, truly immutable)
      this.pinnedLastPages.set(key, catNumbers);
    } else {
      // Middle pages (LRU)
      this.paginationCache.set(key, catNumbers);
    }
  }

  // --- Totals ---

  getTotalCatCount(): number {
    return this.totalCatCount;
  }

  getLastSyncedCatNumber(): number {
    return this.lastSyncedCatNumber;
  }

  setTotals(total: number, lastSynced: number): void {
    this.totalCatCount = total;
    this.lastSyncedCatNumber = lastSynced;
  }

  // --- Sync notification ---

  onNewCatsSynced(newMax: number): void {
    this.lastSyncedCatNumber = newMax;
    this.totalCatCount = newMax + 1;

    // First pages shifted (newest cats changed)
    this.pinnedFirstPages.clear();

    // Clear page 1 from LRU too (if it ended up there)
    // Common ipp values used by the frontend
    for (const ipp of [48, 100]) {
      this.paginationCache.delete(`${ipp}:1`);
    }

    this.logger.debug(
      `Cache updated: ${this.totalCatCount} cats, pinned first pages cleared`,
    );
  }

  // --- Memory monitoring ---

  private adjustCacheSizes(): void {
    const { rss } = process.memoryUsage();
    const targetMax = CONTAINER_LIMIT * MEMORY_TARGET_RATIO;
    const headroom = targetMax - rss;

    if (headroom < DANGER_HEADROOM) {
      const newCatSize = Math.max(
        1000,
        Math.floor(this.catsByNumber.getMaxSize() * 0.5),
      );
      this.catsByNumber.setMaxSize(newCatSize);
      this.logger.warn(
        `Low memory (RSS: ${(rss / 1024 / 1024).toFixed(0)}MB), cat cache shrunk to ${newCatSize}`,
      );
    } else if (headroom > GROWTH_HEADROOM) {
      const newCatSize = Math.min(
        DEFAULT_CAT_CAPACITY * 2,
        this.catsByNumber.getMaxSize() + 2000,
      );
      this.catsByNumber.setMaxSize(newCatSize);
    }
  }

  // --- Stats (for logging/debugging) ---

  getStats() {
    return {
      cats: this.catsByNumber.size,
      catsMax: this.catsByNumber.getMaxSize(),
      txHashIndex: this.txHashToNumber.size,
      pagination: this.paginationCache.size,
      pinnedFirst: this.pinnedFirstPages.size,
      pinnedLast: this.pinnedLastPages.size,
      totalCatCount: this.totalCatCount,
      lastSyncedCatNumber: this.lastSyncedCatNumber,
    };
  }
}
