import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WhitelistEntity } from './whitelist.entity';

@Injectable()
export class WhitelistEntitiesService {

  constructor(@InjectRepository(WhitelistEntity) private repo: Repository<WhitelistEntity>) { }

  /**
   * Returns all entities in DB.
   */
  findAll(): Promise<WhitelistEntity[]> {
    return this.repo.find();
  }

  /**
   * Finds one entity by wallet address.
   * If entity was not found in the database - returns null.
   */
  findOne(walletAddress: string): Promise<WhitelistEntity | null> {
    return this.repo.findOneBy({ walletAddress });
  }

  /**
   * Upserts all given entities in the database.
   */
  upsert(whitelistEntities: WhitelistEntity[]): Promise<any> {
    return this.repo.upsert(whitelistEntities, ['walletAddress'])
  }

  /**
   * Removes a given entities from the database.
   */
  async remove(whitelistId: number): Promise<void> {
    await this.repo.delete(whitelistId);
  }

  /**
   * Counts all unique entries in the WL DB
   */
  async countLevels(): Promise<any> {
    const counts = await this.repo.createQueryBuilder('whitelist')
      .select('level')
      .addSelect('COUNT(*)', 'count')
      .groupBy('level')
      .getRawMany();
    return counts.reduce((acc, { level, count }) => ({ ...acc, [level]: parseInt(count, 10) }), {});
  }
}
