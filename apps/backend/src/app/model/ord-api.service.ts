import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { retry } from '../utils/retry';
import { TransactionOutputOrd } from '../types/transaction-output-ord';


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
}
