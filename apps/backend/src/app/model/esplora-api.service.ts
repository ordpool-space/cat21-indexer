import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { Transaction } from '../types/transaction-esplora';
import { retry } from '../utils/retry';


/**
 * Not used at the moment!
 * Service to interact with an Esplora API for fetching Bitcoin data.
 */
@Injectable()
export class EsploraApiService {

  private readonly BASE_URL: string;

  constructor(configService: ConfigService) {
    this.BASE_URL = configService.get<string>('esploraBaseUrl');
  }

  /**
   * Fetches data about a single Bitcoin transaction.
   * Retries the request several times.
   *
   * @param network - Empty for Bitcoin Mainnet, 'testnet' for Testnet
   * @returns A promise containing the transaction.
   * @throws Throws an error if the maximum retry attempts are reached.
   */
  async fetchTransaction(txId: string, network: '' | 'testnet' = ''): Promise<Transaction> {

    return retry(async () => {
      const response = await axios.get<Transaction>(
        `${this.BASE_URL}/${network ? network + '/' : ''}api/tx/${txId}`);
      return response.data;
    });
  }

  /**
   * Enriches a list of transactions from Blockchair with additional data from the Esplora API,
   * processing each transaction sequentially to avoid hitting rate limits.
   *
   * @param transactions - Array of transactions from Blockchair.
   * @returns - A promise containing an array of enriched transactions.
   */
  async enrichTransactions(transactions: { hash: string }[]): Promise<Transaction[]> {

    const enrichedTransactions: Transaction[] = [];

    for (const transaction of transactions) {
      try {

        const txn = await this.fetchTransaction(transaction.hash);
        enrichedTransactions.push(txn);

      } catch (error) {
        Logger.warn(`** Error enriching data for transaction ${transaction.hash }. **`, error);
        throw error;
      }
    }

    return enrichedTransactions;
  }
}
