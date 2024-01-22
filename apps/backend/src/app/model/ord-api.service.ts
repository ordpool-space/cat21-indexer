import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { TransactionOutputOrd } from '../types/transaction-output-ord';
import { retry } from '../utils/retry';


/**
 * Service to interact with an Ordinals API
 */
@Injectable()
export class OrdApiService {

  private readonly BASE_URL: string;
  private readonly BASE_URL_TESTNET: string;


  constructor(configService: ConfigService) {
    this.BASE_URL = configService.get<string>('ordBaseUrl');
    this.BASE_URL_TESTNET = configService.get<string>('ordBaseUrlTestnet');
  }

  /**
   * Fetches data about a single Bitcoin transaction output.
   * Retries the request several times.
   *
   * @param network - Empty for Bitcoin Mainnet, 'testnet' for Testnet
   * @returns A promise containing the transaction.
   * @throws Throws an error if the maximum retry attempts are reached.
   */
  async fetchOutput(output: string, network: '' | 'testnet' = ''): Promise<TransactionOutputOrd> {

    return retry(async () => {
      const response = await axios.get<TransactionOutputOrd>(
        `${!network ? this.BASE_URL : this.BASE_URL_TESTNET}/output/${output}`, {
        headers: {
          accept: 'application/json'
        }
      });
      return response.data;
    });
  }

  /**
   * Fetches satoshi ranges for a list of UTXOs from the Ordinals API.
   * This method iterates over the provided UTXOs, fetching data for each,
   * and aggregates their satoshi ranges if available.
   *
   * @param utxos - Array of UTXO strings to fetch satoshi ranges for.
   * @param network - Optional network parameter, default is mainnet. Use 'testnet' for Testnet.
   * @returns A promise that resolves to an array of satoshi ranges.
   * @throws Throws an error if any of the UTXO fetch operations fail.
   */
  async fetchSatRangesForUtxos(utxos: string[], network: '' | 'testnet' = ''): Promise<[number, number][]> {
    const satRanges: [number, number][] = [];

    for (const utxo of utxos) {
      const output = await this.fetchOutput(utxo, network);
      if (output.sat_ranges) {
        for (const range of output.sat_ranges) {
          satRanges.push(range);
        }
      }
    }

    return satRanges;
  }
}
