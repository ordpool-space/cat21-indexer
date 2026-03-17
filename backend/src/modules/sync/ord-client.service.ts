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

  async getLatestCatNumber(): Promise<number> {
    const data = await this.fetchJson<{ ids: string[] }>(`${this.baseUrl}/cats`);
    if (data.ids.length === 0) return -1;

    const newest = await this.getCat(data.ids[0]);
    return newest?.number ?? -1;
  }

  async getCat(catNumberOrId: number | string): Promise<OrdCatDetail | null> {
    return this.fetchJson<OrdCatDetail>(`${this.baseUrl}/cat/${catNumberOrId}`, true);
  }

  async getBlockHash(height: number): Promise<string> {
    const data = await this.fetchJson<{ hash: string }>(`${this.baseUrl}/block/${height}`);
    return data.hash;
  }

  private async fetchJson<T>(url: string, allow404: true): Promise<T | null>;
  private async fetchJson<T>(url: string, allow404?: false): Promise<T>;
  private async fetchJson<T>(url: string, allow404 = false): Promise<T | null> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (allow404 && res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`ord API error: ${res.status} ${res.statusText} for ${url}`);
    }

    return res.json() as Promise<T>;
  }
}
