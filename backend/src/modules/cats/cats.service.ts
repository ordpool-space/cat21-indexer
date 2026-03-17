import { Injectable } from '@nestjs/common';
import { count, eq, desc, max } from 'drizzle-orm';
import { Cat21ParserService } from 'ordpool-parser';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { cats } from '../shared/drizzle/schema/cats';
import { CatDto, CatsPaginatedResultDto, HealthDto, StatusDto } from './dto/cat.dto';

@Injectable()
export class CatsService {
  private readonly startedAt = Date.now();

  constructor(private readonly drizzle: DrizzleService) {}

  getHealth(): HealthDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }

  async getStatus(): Promise<StatusDto> {
    const [result] = await this.drizzle.db
      .select({
        totalCats: count(),
        lastSyncedCatNumber: max(cats.catNumber),
      })
      .from(cats);

    return {
      totalCats: result.totalCats,
      lastSyncedCatNumber: result.lastSyncedCatNumber ?? -1,
    };
  }

  async getCatByNumber(catNumber: number): Promise<CatDto | null> {
    const [result] = await this.drizzle.db
      .select()
      .from(cats)
      .where(eq(cats.catNumber, catNumber));

    if (!result) return null;
    return this.mapToDto(result);
  }

  async getCatByTxHash(txHash: string): Promise<CatDto | null> {
    const [result] = await this.drizzle.db
      .select()
      .from(cats)
      .where(eq(cats.txHash, txHash));

    if (!result) return null;
    return this.mapToDto(result);
  }

  async getCats(
    itemsPerPage: number,
    currentPage: number,
  ): Promise<CatsPaginatedResultDto> {
    const offset = (currentPage - 1) * itemsPerPage;

    const [totalResult] = await this.drizzle.db
      .select({ count: count() })
      .from(cats);

    const results = await this.drizzle.db
      .select()
      .from(cats)
      .orderBy(desc(cats.catNumber))
      .limit(itemsPerPage)
      .offset(offset);

    return {
      cats: results.map((r) => this.mapToDto(r)),
      total: totalResult.count,
      currentPage,
      itemsPerPage,
    };
  }

  async getCatSvg(catNumber: number): Promise<string | null> {
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
      mintedAt: row.mintedAt?.toISOString() ?? null,
      mintedBy: row.mintedBy,
      fee: row.fee,
      weight: row.weight,
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
