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
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  save(whitelistEntities: WhitelistEntity[]): Promise<WhitelistEntity[]> {
    return this.repo.save(whitelistEntities)
  }

  /**
   * Removes a given entities from the database.
   */
  async remove(whitelistId: number): Promise<void> {
    await this.repo.delete(whitelistId);
  }
}
