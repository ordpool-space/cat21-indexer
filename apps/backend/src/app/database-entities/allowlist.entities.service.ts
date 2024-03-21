import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllowlistEntity } from './allowlist.entity';

@Injectable()
export class AllowlistEntitiesService {

  constructor(@InjectRepository(AllowlistEntity) private repo: Repository<AllowlistEntity>) { }

  /**
   * Returns all entities in DB.
   */
  findAll(): Promise<AllowlistEntity[]> {
    return this.repo.find();
  }

  /**
   * Finds first entity by id.
   * If entity was not found in the database - returns null.
   */
  findOne(allowlistId: number): Promise<AllowlistEntity | null> {
    return this.repo.findOneBy({ allowlistId });
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  save(allowlistEntities: AllowlistEntity[]): Promise<AllowlistEntity[]> {
    return this.repo.save(allowlistEntities)
  }

  /**
   * Removes a given entities from the database.
   */
  async remove(allowlistId: number): Promise<void> {
    await this.repo.delete(allowlistId);
  }
}
