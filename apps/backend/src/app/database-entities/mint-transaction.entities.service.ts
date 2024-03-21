import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MintTransactionEntity } from './mint-transaction.entity';

@Injectable()
export class MintTransactionEntitiesService {

  constructor(@InjectRepository(MintTransactionEntity) private repo: Repository<MintTransactionEntity>) { }

  /**
   * Returns all entities in DB.
   */
  findAll(): Promise<MintTransactionEntity[]> {
    return this.repo.find();
  }

  /**
   * Finds first entity by id.
   * If entity was not found in the database - returns null.
   */
  findOne(transactionId: string): Promise<MintTransactionEntity | null> {
    return this.repo.findOneBy({ transactionId });
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  save(cat21Entities: MintTransactionEntity[]): Promise<MintTransactionEntity[]> {
    return this.repo.save(cat21Entities)
  }
}
