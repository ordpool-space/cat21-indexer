import { Injectable } from '@nestjs/common';
import { count, eq, inArray, max, sum } from 'drizzle-orm';
import { Cat21ParserService } from 'ordpool-parser';
import { CacheService } from '../shared/cache/cache.service';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { cats } from '../shared/drizzle/schema/cats';
import { CatDto, CatNumbersPaginatedResultDto, CatsPaginatedResultDto, HealthDto, StatusDto } from './dto/cat.dto';

@Injectable()
export class CatsService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly cache: CacheService,
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
