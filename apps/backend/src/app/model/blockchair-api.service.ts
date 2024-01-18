import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * Bitcoin Transaction in the format of the Blockchair API
 */
export interface Transaction {
  block_id: number;
  id: number;
  hash: string;
  date: string;
  time: string;
  size: number;
  weight: number;
  version: number;
  lock_time: number;
  is_coinbase: boolean;
  has_witness: boolean;
  input_count: number;
  output_count: number;
  input_total: number;
  input_total_usd: number;
  output_total: number;
  output_total_usd: number;
  fee: number;
  fee_usd: number;
  fee_per_kb: number;
  fee_per_kb_usd: number;
  fee_per_kwu: number;
  fee_per_kwu_usd: number;
  cdd_total: number;
}

interface Context {
  code: number;
  source: string;
  limit: number;
  offset: number;
  rows: number;
  total_rows: number;
  state: number;
  market_price_usd: number;
}

interface ApiResponse {
  data: Transaction[];
  context: Context;
}


/**
 * Service to interact with the Blockchair API for fetching Bitcoin transactions.
 */
@Injectable()
export class BlockchairApiService {

  private readonly BASE_URL = 'https://api.blockchair.com/bitcoin';
  private readonly MAX_RETRIES = 2;

  /**
   * Fetches a limited number of transactions starting from a specific offset.
   * Retries the request up to a maximum of MAX_RETRIES times in case of failure.
   *
   * @param limit - The number of transactions to fetch in one call.
   * @param offset - The offset from where to start fetching transactions.
   * @param network - Empty for Bitcoin Mainnet, 'testnet' for Testnet
   * @returns A promise that resolves to the response containing the transactions.
   * @throws Throws an error if the maximum retry attempts are reached or the request fails.
   */
  private async fetchTransactions(limit: number, offset: number, network = ''): Promise<Transaction[]> {
    let attempts = 0;

    if (network) {
      network = network + '/';
    }

    while (attempts <= this.MAX_RETRIES) {
      try {
        const response = await axios.get<ApiResponse>(`${this.BASE_URL}/${network}transactions?q=lock_time(21)&limit=${limit}&offset=${offset}`);
        return response.data.data;

      } catch (error) {
        attempts++;
        Logger.error(`Attempt #${attempts} failed:`, error, 'blockchair_api_service');
      }
    }

    throw new Error(`Failed to fetch transactions from Blockchair after #${attempts} attempts.`);
  }

  /**
   * Fetches all transactions by repeatedly calling the Blockchair API.
   * Stops fetching when no more results are returned or the result count is less than the limit.
   *
   * @param limit - The number of transactions to fetch in each API call.
   * @param network - Empty for Bitcoin Mainnet, 'testnet' for Testnet
   * @returns A promise that resolves to an array of all fetched transactions.
   */
  async fetchAllTransactions(limit: number, network = ''): Promise<Transaction[]> {
    let offset = 0;
    let allTransactions: Transaction[] = [];
    let hasMoreResults = true;

    while (hasMoreResults) {
      const transactions = await this.fetchTransactions(limit, offset, network);
      if (transactions.length === 0 || transactions.length < limit) {
        hasMoreResults = false;
      }

      allTransactions = allTransactions.concat(transactions);
      offset += limit;
    }

    return allTransactions;
  }
}
