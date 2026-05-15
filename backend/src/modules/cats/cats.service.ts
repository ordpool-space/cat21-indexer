import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, max, or, sql, sum, type SQL } from 'drizzle-orm';
import { Cat21ParserService } from 'ordpool-parser';
import { CacheService } from '../shared/cache/cache.service';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { cats } from '../shared/drizzle/schema/cats';
import { SyncService } from '../sync/sync.service';
import { CatDto, CatNumbersPaginatedResultDto, CatsPaginatedResultDto, ExtendedHealthDto, HealthDto, StatusDto } from './dto/cat.dto';

/**
 * Trait filters for the cat search endpoint. Each field is a list of accepted
 * values (OR within a field). Multiple fields are AND-combined. An undefined
 * or empty field means "no filter on that trait".
 */
export interface SearchFilters {
  eyes?: string[];
  pose?: string[];
  expression?: string[];
  pattern?: string[];
  background?: string[];
  crown?: string[];
  glasses?: string[];
  category?: string[];
  gender?: string[];
  color?: string[];
}

const SYNC_STALL_SECONDS = 300;

@Injectable()
export class CatsService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly cache: CacheService,
    private readonly sync: SyncService,
  ) {}

  getHealth(): HealthDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      cache: this.cache.getStats(),
    };
  }

  async getExtendedHealth(): Promise<ExtendedHealthDto> {
    const pingStart = Date.now();
    let reachable = false;
    let latencyMs: number | null = null;
    let dbError: string | null = null;
    try {
      await this.drizzle.db.execute(sql`SELECT 1`);
      reachable = true;
      latencyMs = Date.now() - pingStart;
    } catch (e) {
      dbError = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    }

    const syncHealth = this.sync.getSyncHealth();
    const now = Date.now();
    const secondsSinceLastSuccess = syncHealth.lastSuccessAt
      ? Math.floor((now - syncHealth.lastSuccessAt.getTime()) / 1000)
      : null;
    const stalled =
      secondsSinceLastSuccess === null || secondsSinceLastSuccess > SYNC_STALL_SECONDS;

    let status: 'ok' | 'degraded' | 'down';
    if (!reachable) {
      status = 'down';
    } else if (stalled) {
      status = 'degraded';
    } else {
      status = 'ok';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor((now - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      database: { reachable, latencyMs, error: dbError },
      sync: {
        lastSuccessAt: syncHealth.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: syncHealth.lastErrorAt?.toISOString() ?? null,
        lastError: syncHealth.lastError,
        secondsSinceLastSuccess,
        stalled,
      },
      cache: this.cache.getStats(),
    };
  }

  async getStatus(): Promise<StatusDto> {
    await this.ensureTotalsPrimed();
    return {
      totalCats: this.cache.getTotalCatCount(),
      lastSyncedCatNumber: this.cache.getLastSyncedCatNumber(),
      proofOfCatWork: this.cache.getProofOfCatWork(),
    };
  }

  async getCatByNumber(catNumber: number): Promise<CatDto | null> {
    const cached = this.cache.getCachedCat(catNumber);
    if (cached) return cached;

    const [result] = await this.drizzle.db
      .select()
      .from(cats)
      .where(eq(cats.catNumber, catNumber));

    if (!result) return null;

    const dto = this.mapToDto(result);
    this.cache.setCachedCat(dto);
    return dto;
  }

  async getCatByTxHash(txHash: string): Promise<CatDto | null> {
    const catNumber = this.cache.getCachedCatNumberByTxHash(txHash);
    if (catNumber !== undefined) {
      const cached = this.cache.getCachedCat(catNumber);
      if (cached) return cached;
    }

    const [result] = await this.drizzle.db
      .select()
      .from(cats)
      .where(eq(cats.txHash, txHash));

    if (!result) return null;

    const dto = this.mapToDto(result);
    this.cache.setCachedCat(dto);
    return dto;
  }

  async getCats(
    itemsPerPage: number,
    currentPage: number,
  ): Promise<CatsPaginatedResultDto> {
    // Ensure we know the total before computing page boundaries.
    await this.ensureTotalsPrimed();

    const catNumbers = this.cache.computeCatNumbersForPage(itemsPerPage, currentPage);
    const total = this.cache.getTotalCatCount();

    if (catNumbers.length === 0) {
      return { cats: [], total, currentPage, itemsPerPage };
    }

    // Cache-first lookup: find which cat numbers are missing.
    const catsFromCache = new Map<number, CatDto>();
    const missingNumbers: number[] = [];
    for (const n of catNumbers) {
      const cached = this.cache.getCachedCat(n);
      if (cached) {
        catsFromCache.set(n, cached);
      } else {
        missingNumbers.push(n);
      }
    }

    // Batch-fetch ONLY misses.
    if (missingNumbers.length > 0) {
      const rows = await this.drizzle.db
        .select()
        .from(cats)
        .where(inArray(cats.catNumber, missingNumbers));

      for (const row of rows) {
        const dto = this.mapToDto(row);
        this.cache.setCachedCat(dto);
        catsFromCache.set(dto.catNumber, dto);
      }
    }

    // Assemble in page order (DESC by catNumber, as given by computeCatNumbersForPage).
    const dtos = catNumbers
      .map((n) => catsFromCache.get(n))
      .filter((c): c is CatDto => c !== undefined);

    return {
      cats: dtos,
      total,
      currentPage,
      itemsPerPage,
    };
  }

  async getCatNumbers(
    itemsPerPage: number,
    currentPage: number,
  ): Promise<CatNumbersPaginatedResultDto> {
    // Ensure we know the total before computing page boundaries.
    await this.ensureTotalsPrimed();

    const catNumbers = this.cache.computeCatNumbersForPage(itemsPerPage, currentPage);
    const total = this.cache.getTotalCatCount();

    return {
      catNumbers,
      total,
      currentPage,
      itemsPerPage,
    };
  }

  /**
   * Trait search. Returns paginated cat numbers matching the filter set.
   *
   * Each filter value list is OR-combined within the field; fields are
   * AND-combined across the query. Empty filter (no fields set) is allowed
   * and returns the full result set sorted newest-first — same shape as
   * `getCatNumbers`, just without the in-memory shortcut.
   *
   * The shortcut path (in-memory cat number range) used by `getCatNumbers`
   * is intentionally not reused: filter combinations partition the result
   * set differently each time, so the cache wouldn't help.
   */
  async searchCatNumbers(
    filters: SearchFilters,
    itemsPerPage: number,
    currentPage: number,
  ): Promise<CatNumbersPaginatedResultDto> {
    const where = buildSearchWhere(filters);
    const offset = (currentPage - 1) * itemsPerPage;

    // Total + page in parallel; both queries hit the same indexed columns.
    const [[totalRow], rows] = await Promise.all([
      this.drizzle.db.select({ count: count() }).from(cats).where(where),
      this.drizzle.db
        .select({ catNumber: cats.catNumber })
        .from(cats)
        .where(where)
        .orderBy(desc(cats.catNumber))
        .limit(itemsPerPage)
        .offset(offset),
    ]);

    return {
      catNumbers: rows.map((r) => r.catNumber),
      total: totalRow.count,
      currentPage,
      itemsPerPage,
    };
  }

  /**
   * Return one random cat number matching the supplied filters, or `null`
   * if nothing matches. Powered by `ORDER BY RAND() LIMIT 1` — the
   * filter set runs against the same indexed columns as the paginated
   * search, so even with no filters this is one disk-IO-bound query on
   * the full table (a few ms for ~500k rows).
   */
  async randomCatNumber(filters: SearchFilters): Promise<number | null> {
    const where = buildSearchWhere(filters);
    const [row] = await this.drizzle.db
      .select({ catNumber: cats.catNumber })
      .from(cats)
      .where(where)
      .orderBy(sql`RAND()`)
      .limit(1);
    return row?.catNumber ?? null;
  }

  /**
   * On cold start, one DB query primes totals and Proof of Cat Work.
   * Subsequent calls use cached values (maintained by sync notifications).
   */
  private async ensureTotalsPrimed(): Promise<void> {
    if (this.cache.getLastSyncedCatNumber() >= 0) return;

    const [result] = await this.drizzle.db
      .select({
        totalCats: count(),
        lastSyncedCatNumber: max(cats.catNumber),
        proofOfCatWork: sum(cats.fee),
      })
      .from(cats);

    this.cache.setTotals(result.totalCats, result.lastSyncedCatNumber ?? -1);
    this.cache.setProofOfCatWork(Number(result.proofOfCatWork ?? 0));
  }

  async getCatSvg(catNumber: number): Promise<string | null> {
    // SVGs are cached at Cloudflare edge (1 year, immutable).
    // No in-memory cache needed here.
    const [row] = await this.drizzle.db
      .select({
        txHash: cats.txHash,
        weight: cats.weight,
        fee: cats.fee,
        blockHash: cats.blockHash,
      })
      .from(cats)
      .where(eq(cats.catNumber, catNumber));

    if (!row) return null;

    const parsed = Cat21ParserService.parse({
      txid: row.txHash,
      locktime: 21,
      weight: row.weight,
      fee: row.fee,
      status: { block_hash: row.blockHash },
    });

    return parsed?.getImage() ?? null;
  }

  private mapToDto(row: typeof cats.$inferSelect): CatDto {
    return {
      id: row.id,
      catNumber: row.catNumber,
      txHash: row.txHash,
      blockHash: row.blockHash,
      blockHeight: row.blockHeight,
      mintedAt: row.mintedAt.toISOString(),
      mintedBy: row.mintedBy,
      fee: row.fee,
      weight: row.weight,
      size: row.size,
      feeRate: row.feeRate,
      sat: row.sat,
      value: row.value,
      category: row.category,
      genesis: row.genesis,
      catColors: row.catColors,
      male: row.male,
      female: row.female,
      designIndex: row.designIndex,
      designPose: row.designPose,
      designExpression: row.designExpression,
      designPattern: row.designPattern,
      designFacing: row.designFacing,
      laserEyes: row.laserEyes,
      background: row.background,
      backgroundColors: row.backgroundColors,
      crown: row.crown,
      glasses: row.glasses,
      glassesColors: row.glassesColors,
    };
  }
}

/**
 * Translates `SearchFilters` into a Drizzle WHERE expression. Each filter
 * field is OR-combined internally; fields are AND-combined together.
 * Returns `undefined` for an empty filter (caller passes `undefined` to
 * `.where()` for no predicate). Exported for unit testing.
 */
export function buildSearchWhere(filters: SearchFilters): SQL | undefined {
  const clauses: SQL[] = [];

  if (filters.eyes?.length) clauses.push(inArray(cats.laserEyes, filters.eyes));
  if (filters.pose?.length) clauses.push(inArray(cats.designPose, filters.pose));
  if (filters.expression?.length) clauses.push(inArray(cats.designExpression, filters.expression));
  if (filters.pattern?.length) clauses.push(inArray(cats.designPattern, filters.pattern));
  if (filters.background?.length) clauses.push(inArray(cats.background, filters.background));
  if (filters.crown?.length) clauses.push(inArray(cats.crown, filters.crown));
  if (filters.glasses?.length) clauses.push(inArray(cats.glasses, filters.glasses));
  if (filters.color?.length) clauses.push(inArray(cats.dominantColorCategory, filters.color));

  if (filters.gender?.length) {
    const genderClauses: SQL[] = [];
    if (filters.gender.includes('male')) genderClauses.push(eq(cats.male, true));
    if (filters.gender.includes('female')) genderClauses.push(eq(cats.female, true));
    if (genderClauses.length === 1) {
      clauses.push(genderClauses[0]);
    } else if (genderClauses.length > 1) {
      clauses.push(or(...genderClauses)!);
    }
  }

  if (filters.category?.length) {
    // Categories are discrete bands: each cat carries exactly one (its
    // smallest applicable, written by `deriveCategory` at insert time).
    // Match the band the cat is stored in; selecting multiple chips
    // OR-combines bands. `genesis` is a separate boolean column.
    const bandValues = filters.category.filter((c) => c !== 'genesis');
    const categoryClauses: SQL[] = [];
    if (bandValues.length > 0) categoryClauses.push(inArray(cats.category, bandValues));
    if (filters.category.includes('genesis')) categoryClauses.push(eq(cats.genesis, true));
    if (categoryClauses.length === 1) {
      clauses.push(categoryClauses[0]);
    } else if (categoryClauses.length > 1) {
      clauses.push(or(...categoryClauses)!);
    }
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return and(...clauses);
}
