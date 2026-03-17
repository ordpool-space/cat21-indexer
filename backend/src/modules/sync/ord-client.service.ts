import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FETCH_TIMEOUT_MS = 30_000;

export interface OrdCatDetail {
  id: string;
  number: number;
  address: string | null;
  sat: number | null;
  fee: number;
  height: number;
  timestamp: number;
  value: number | null;
  weight: number;
}

@Injectable()
export class OrdClientService {
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.getOrThrow<string>('ORD_API_URL');
  }

  /**
   * Fetch the latest cat number by checking the newest entry on /cats.
   */
  async getLatestCatNumber(): Promise<number> {
    const url = `${this.baseUrl}/cats`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`ord API error: ${res.status} ${res.statusText} for ${url}`);
    }

    const data = (await res.json()) as { ids: string[] };
    if (data.ids.length === 0) return -1;

    const newest = await this.getCat(data.ids[0]);
    return newest?.number ?? -1;
  }

  /**
   * Fetch a cat by its cat number or inscription ID.
   */
  async getCat(catNumberOrId: number | string): Promise<OrdCatDetail | null> {
    const url = `${this.baseUrl}/cat/${catNumberOrId}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`ord API error: ${res.status} ${res.statusText} for ${url}`);
    }

    return res.json() as Promise<OrdCatDetail>;
  }

  async getBlockHash(height: number): Promise<string> {
    const url = `${this.baseUrl}/block/${height}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`ord API error: ${res.status} ${res.statusText} for ${url}`);
    }

    const data = (await res.json()) as { hash: string };
    return data.hash;
  }
}
