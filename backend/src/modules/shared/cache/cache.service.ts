import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'node:fs';
import { CatDto } from '../../cats/dto/cat.dto';
import { LruMap } from './lru-map';

const PINNED_COUNT = 2400; // oldest 2400 + newest 2400 cats stay forever
const MIN_CAT_CAPACITY = 2 * PINNED_COUNT + 500; // 5300, never shrink below this
const DEFAULT_CAT_CAPACITY = 10_000;
const MAX_CAT_CAPACITY = 20_000;
const MEMORY_CHECK_INTERVAL = 60_000;
const FALLBACK_MEMORY_LIMIT = 512 * 1024 * 1024; // fallback if cgroup not readable
const MEMORY_TARGET_RATIO = 0.75;
const DANGER_HEADROOM = 20 * 1024 * 1024; // 20 MB
const GROWTH_HEADROOM = 100 * 1024 * 1024; // 100 MB

/**
 * Detects the actual memory limit for this process.
 * On Linux containers (Koyeb, Docker, K8s), this reads the cgroup limit.
 * On Node 20+, we use process.constrainedMemory() which is the cleanest API.
 * Falls back to FALLBACK_MEMORY_LIMIT if nothing works.
 */
function detectMemoryLimit(): number {
  // Node 20+: most reliable
  if (typeof (process as { constrainedMemory?: () => number }).constrainedMemory === 'function') {
    const limit = (process as { constrainedMemory: () => number }).constrainedMemory();
    if (limit > 0) return limit;
  }

  // cgroup v2
  try {
    const content = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (content !== 'max') {
      const n = parseInt(content, 10);
      if (n > 0) return n;
    }
  } catch {
    // ignore
  }

  // cgroup v1
  try {
    const content = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
    const n = parseInt(content, 10);
    if (n > 0 && n < Number.MAX_SAFE_INTEGER / 2) return n;
  } catch {
    // ignore
  }

  return FALLBACK_MEMORY_LIMIT;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly memoryLimit = detectMemoryLimit();

  // The only data cache: all cats keyed by catNumber.
  // Oldest 2400 and newest 2400 are pinned via the isPinned predicate.
  private readonly catsByNumber: LruMap<number, CatDto>;

  // Secondary index for txHash → catNumber lookups.
  // Kept in sync via onEvict when a cat leaves catsByNumber.
  private readonly txHashToNumber = new Map<string, number>();

  // Totals (maintained via auto-bump and sync notifications).
  private totalCatCount = 0;
  private lastSyncedCatNumber = -1;

  // Proof of Cat Work: sum of all mint transaction fees (sats).
  // Refreshed from DB on cold start and after each sync cycle.
  private proofOfCatWork = 0;

  private memoryCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.catsByNumber = new LruMap<number, CatDto>(DEFAULT_CAT_CAPACITY, {
      onEvict: (_key, cat) => this.txHashToNumber.delete(cat.txHash),
      isPinned: (n) => this.isPinnedNumber(n),
    });
  }

  onModuleInit() {
    this.memoryCheckTimer = setInterval(
      () => this.adjustCacheSizes(),
      MEMORY_CHECK_INTERVAL,
    );
    this.logger.log(
      `Cache initialized (capacity: ${DEFAULT_CAT_CAPACITY}, pinned: ${2 * PINNED_COUNT}, memory limit: ${Math.round(this.memoryLimit / 1024 / 1024)}MB)`,
    );
  }

  onModuleDestroy() {
    if (this.memoryCheckTimer) {
      clearInterval(this.memoryCheckTimer);
    }
  }

  // --- Pin predicate ---

  /**
   * A cat number is pinned if it's in the oldest 2400 OR the newest 2400.
   * Pinned entries are never evicted by the LRU.
   * The newest range follows lastSyncedCatNumber automatically.
   */
  private isPinnedNumber(n: number): boolean {
    if (n < PINNED_COUNT) return true; // oldest 2400
    if (this.lastSyncedCatNumber < PINNED_COUNT) return false; // cold start guard
    const newestFloor = this.lastSyncedCatNumber - PINNED_COUNT + 1;
    return n >= newestFloor && n <= this.lastSyncedCatNumber;
  }

  // --- Cat lookups ---

  getCachedCat(catNumber: number): CatDto | undefined {
    return this.catsByNumber.get(catNumber);
  }

  getCachedCatNumberByTxHash(txHash: string): number | undefined {
    return this.txHashToNumber.get(txHash);
  }

  setCachedCat(cat: CatDto): void {
    // Auto-bump: if this cat is newer than we knew about, shift the newest pin range.
    if (cat.catNumber > this.lastSyncedCatNumber) {
      this.lastSyncedCatNumber = cat.catNumber;
      this.totalCatCount = cat.catNumber + 1;
    }
    this.catsByNumber.set(cat.catNumber, cat);
    this.txHashToNumber.set(cat.txHash, cat.catNumber);
  }

  /**
   * Drop one cat from the cache. Next fetch will re-read from the DB.
   * Used by background processes that mutate cat rows directly (rarity
   * backfill is the only current caller) — without this, the cache
   * would keep returning a stale DTO until the entry is evicted by LRU
   * pressure, which never happens for pinned cats (#0 etc.).
   */
  invalidateCat(catNumber: number): void {
    // LruMap.delete fires onEvict, which drops the txHashToNumber entry.
    this.catsByNumber.delete(catNumber);
  }

  // --- Pagination (computed from formula, zero storage) ---

  /**
   * Compute the cat numbers for a given page, sorted newest-first (DESC).
   * Page 1 = newest `ipp` cats, last page = genesis region.
   * Returns an empty array if we don't yet know lastSyncedCatNumber.
   */
  computeCatNumbersForPage(ipp: number, page: number): number[] {
    if (this.lastSyncedCatNumber < 0) return [];
    if (ipp <= 0 || page <= 0) return [];

    const first = this.lastSyncedCatNumber - (page - 1) * ipp;
    if (first < 0) return [];

    const last = Math.max(0, first - ipp + 1);
    const count = first - last + 1;
    const result = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      result[i] = first - i;
    }
    return result;
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

  // --- Proof of Cat Work ---

  getProofOfCatWork(): number {
    return this.proofOfCatWork;
  }

  setProofOfCatWork(sumFromDb: number): void {
    this.proofOfCatWork = sumFromDb;
  }

  // --- Sync notification ---

  /**
   * Called by SyncService after each batch insert (and final sync completion).
   * Idempotent: the `>` guard means repeated calls with same/lower values are no-ops.
   */
  onNewCatsSynced(newMax: number): void {
    if (newMax > this.lastSyncedCatNumber) {
      this.lastSyncedCatNumber = newMax;
      this.totalCatCount = newMax + 1;
    }
  }

  // --- Memory monitoring ---

  private getMemoryInfo() {
    const { rss, heapUsed, heapTotal } = process.memoryUsage();
    const targetMax = this.memoryLimit * MEMORY_TARGET_RATIO;
    const headroom = targetMax - rss;
    return { rss, heapUsed, heapTotal, targetMax, headroom };
  }

  /**
   * Clamp cache capacity between MIN and MAX.
   * MIN (5300) guarantees pinned entries (4800) plus buffer (500) always fit.
   */
  private clampCapacity(desired: number): number {
    return Math.max(MIN_CAT_CAPACITY, Math.min(MAX_CAT_CAPACITY, desired));
  }

  private adjustCacheSizes(): void {
    const { rss, headroom } = this.getMemoryInfo();
    const currentMax = this.catsByNumber.getMaxSize();

    if (headroom < DANGER_HEADROOM) {
      const newSize = this.clampCapacity(Math.floor(currentMax * 0.5));
      if (newSize !== currentMax) {
        this.catsByNumber.setMaxSize(newSize);
        this.logger.warn(
          `Low memory (RSS: ${(rss / 1024 / 1024).toFixed(0)}MB, headroom: ${(headroom / 1024 / 1024).toFixed(0)}MB), cat cache shrunk to ${newSize}`,
        );
      }
    } else if (headroom > GROWTH_HEADROOM) {
      const newSize = this.clampCapacity(currentMax + 2000);
      if (newSize !== currentMax) {
        this.catsByNumber.setMaxSize(newSize);
      }
    }
  }

  // --- Stats (for logging/debugging) ---

  getStats() {
    const mem = this.getMemoryInfo();
    return {
      cats: this.catsByNumber.size,
      catsMax: this.catsByNumber.getMaxSize(),
      txHashIndex: this.txHashToNumber.size,
      totalCatCount: this.totalCatCount,
      lastSyncedCatNumber: this.lastSyncedCatNumber,
      proofOfCatWork: this.proofOfCatWork,
      memoryLimitMB: Math.round(this.memoryLimit / 1024 / 1024),
      memoryTargetMB: Math.round(mem.targetMax / 1024 / 1024),
      memoryHeadroomMB: Math.round(mem.headroom / 1024 / 1024),
      memoryRssMB: Math.round(mem.rss / 1024 / 1024),
      memoryHeapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    };
  }
}
