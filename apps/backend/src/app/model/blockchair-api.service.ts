import { Injectable } from '@nestjs/common';
import axios from 'axios';

import { ApiResponseBlockchair, TransactionBlockchair } from '../types/transaction-blockchair';
import { retry } from '../utils/retry';


/**
 * Service to interact with the Blockchair API for fetching Bitcoin transactions.
 */
@Injectable()
export class BlockchairApiService {

  private readonly BASE_URL = 'https://api.blockchair.com/bitcoin';

  /**
   * Fetches a limited number of CAT-21 transactions starting from a specific offset.
   * Retries the request several times.
   *
   * @param limit - The number of transactions to fetch in one call.
   * @param offset - The offset from where to start fetching transactions.
   * @param network - Empty for Bitcoin Mainnet, 'testnet' for Testnet
   * @returns A promise containing the transactions.
   * @throws Throws an error if the maximum retry attempts are reached.
   */
  private async fetchCat21Transactions(limit: number, offset: number, network: '' | 'testnet' = ''): Promise<TransactionBlockchair[]> {

    // regarding the date:
    // on testnet there are some old lockTime=21 transactions from 2017
    // but ord does not provide sat-ranges for these old times
    // solution: search only for transactions since 2023

    return retry(async () => {
      const response = await axios.get<ApiResponseBlockchair>(
        `${this.BASE_URL}/${network ? network + '/' : ''}transactions`,
        {
          params: {
            'q': 'lock_time(21),time(2023-01-01..)',
            limit,
            offset
          }
        });
      return response.data.data;
    });
  }

  /**
   * Fetches all transactions by repeatedly calling the Blockchair API.
   * Stops fetching when no more results are returned or the result count is less than the limit.
   *
   * @param pageSize - The number of transactions to fetch in each API call.
   * @param network - Empty for Bitcoin Mainnet, 'testnet' for Testnet
   * @returns A promise that resolves to an array of all fetched transactions.
   */
  async fetchAllCat21Transactions(pageSize = 100, network: '' | 'testnet' = ''): Promise<TransactionBlockchair[]> {
    let offset = 0;
    let allTransactions: TransactionBlockchair[] = [];
    let hasMoreResults = true;

    while (hasMoreResults) {
      const transactions = await this.fetchCat21Transactions(pageSize, offset, network);
      if (transactions.length === 0 || transactions.length < pageSize) {
        hasMoreResults = false;
      }

      allTransactions = allTransactions.concat(transactions);
      offset += pageSize;
    }

    return allTransactions;
  }
}
