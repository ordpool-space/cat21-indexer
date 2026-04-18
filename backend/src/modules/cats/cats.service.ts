import { Injectable } from '@nestjs/common';
import { count, eq, desc, max } from 'drizzle-orm';
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
    const total = this.cache.getTotalCatCount();
    if (total > 0) {
      return {
        totalCats: total,
        lastSyncedCatNumber: this.cache.getLastSyncedCatNumber(),
      };
    }

    // Cold start: populate from DB
    const [result] = await this.drizzle.db
      .select({
        totalCats: count(),
        lastSyncedCatNumber: max(cats.catNumber),
      })
      .from(cats);

    const status = {
      totalCats: result.totalCats,
      lastSyncedCatNumber: result.lastSyncedCatNumber ?? -1,
    };
    this.cache.setTotals(status.totalCats, status.lastSyncedCatNumber);
    return status;
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
    const offset = (currentPage - 1) * itemsPerPage;
    const cachedTotal = this.cache.getTotalCatCount();

    const [totalQuery, results] = await Promise.all([
      cachedTotal > 0
        ? Promise.resolve([{ count: cachedTotal }])
        : this.drizzle.db.select({ count: count() }).from(cats),
      this.drizzle.db.select().from(cats).orderBy(desc(cats.catNumber)).limit(itemsPerPage).offset(offset),
    ]);
    const [totalResult] = totalQuery;

    const dtos = results.map((r) => {
      const dto = this.mapToDto(r);
      this.cache.setCachedCat(dto);
      return dto;
    });

    return {
      cats: dtos,
      total: totalResult.count,
      currentPage,
      itemsPerPage,
    };
  }

  async getCatNumbers(
    itemsPerPage: number,
    currentPage: number,
  ): Promise<CatNumbersPaginatedResultDto> {
    const cachedTotal = this.cache.getTotalCatCount();
    const cachedNumbers = this.cache.getCachedCatNumbers(itemsPerPage, currentPage);

    if (cachedNumbers && cachedTotal > 0) {
      return {
        catNumbers: cachedNumbers,
        total: cachedTotal,
        currentPage,
        itemsPerPage,
      };
    }

    const offset = (currentPage - 1) * itemsPerPage;

    const [totalQuery, results] = await Promise.all([
      cachedTotal > 0
        ? Promise.resolve([{ count: cachedTotal }])
        : this.drizzle.db.select({ count: count() }).from(cats),
      this.drizzle.db.select({ catNumber: cats.catNumber }).from(cats).orderBy(desc(cats.catNumber)).limit(itemsPerPage).offset(offset),
    ]);
    const [totalResult] = totalQuery;
    const catNumbers = results.map((r) => r.catNumber);

    this.cache.setCachedCatNumbers(itemsPerPage, currentPage, catNumbers);

    return {
      catNumbers,
      total: totalResult.count,
      currentPage,
      itemsPerPage,
    };
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
