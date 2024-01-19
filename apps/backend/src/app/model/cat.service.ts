import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { Cat21 } from '../types/cat21';
import { BlockchairApiService, Transaction } from './blockchair-api.service';



@Injectable()
export class CatService {

  private allCats: Cat21[] = [];

  constructor(private blockchairApi: BlockchairApiService) {
  }

  /**
   * Performing async tasks before controllers are available
   */
  async onModuleInit() {
    // return; // while debugging
    Logger.log('Initializing CatService', 'cat_service');
    await this.handleInterval(); // immediate execution upon module initialization

    Logger.verbose('Fetched ' + this.allCats.length + ' CAT-21 assets', 'cat_service');
  }

  @Interval(1000 * 60 * 5) // every 5 minutes
  async handleInterval() {
    await this.indexAllCats();
  }

  private async indexAllCats() {

    const transactions = await this.blockchairApi.fetchAllTransactions(100);

    // if the amount of transactions is smaller (for whatever reason), then we prefer to keep the old data
    if (this.allCats.length < transactions.length) {
      Logger.log(`Updating cached cats with ${transactions.length} entries!`, 'cat_service');
      this.allCats = this.transactionsToCats(transactions);
    }
  }

  /**
   * Retrieves all cats (cached)
   */
  async getAllCats(): Promise<Cat21[]> {

    // something must have went very wrong?! we still have a count of zero?
    // try it again to build an index
    if (!this.allCats.length) {
      await this.indexAllCats();
    }

    // copy to new array to protect against mutation (required if we reverse the array)
    // return this.allCats.map(c => c);

    return this.allCats;
  }

  private transactionsToCats(transactions: Transaction[]): Cat21[] {

    let counter = transactions.length - 1;
    const cats = transactions.map(tx => ({
      transactionId: tx.hash,
      number: counter--,
      blockHeight: tx.block_id,
      fee: tx.fee,
      size: tx.size,
      weight: tx.weight
    }));

    return cats;
  }
}
