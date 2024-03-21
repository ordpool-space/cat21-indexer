import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cat21Entity } from './cat21.entity';

@Injectable()
export class Cat21EntitiesService {

  constructor(@InjectRepository(Cat21Entity) private repo: Repository<Cat21Entity>) { }

  /**
   * Returns all entities in DB.
   */
  findAll(): Promise<Cat21Entity[]> {
    return this.repo.find();
  }

  /**
   * Finds first entity by id.
   * If entity was not found in the database - returns null.
   */
  findOne(transactionId: string): Promise<Cat21Entity | null> {
    return this.repo.findOneBy({ transactionId });
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  save(cat21Entities: Cat21Entity[]): Promise<Cat21Entity[]> {
    return this.repo.save(cat21Entities)
  }
}
