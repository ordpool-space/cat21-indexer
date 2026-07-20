import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FETCH_TIMEOUT_MS = 30_000;

export interface OrdCatDetail {
  id: string;
  number: number;
  minted_by: string | null;    // first owner from mint tx output 0
  sat: number;
  fee: number;
  height: number;
  block_hash: string | null;   // hash of the mining block; with txid + fee + weight it renders the cat
  timestamp: number;
  value: number;
  weight: number;
  size: number;
}

/**
 * Response shape for `ord`'s `/inscription/:id` endpoint (used to find
 * a cat's CURRENT outpoint after transfers). ord tracks per-inscription
 * satpoint reassignment as sats move; we only need the current one.
 */
export interface OrdInscriptionDetail {
  /** "TXID:VOUT:OFFSET" of the current UTXO. */
  satpoint: string;
  /** Owning address at the current satpoint. Null for unspendable outputs. */
  address: string | null;
}

/**
 * Where a cat currently lives on-chain: the outpoint (txid + vout)
 * of its UTXO, and the address that controls it. `null` when ord
 * doesn't know the cat OR the satpoint parse fails.
 */
export interface CatCurrentLocation {
  txid: string;
  vout: number;
  ordinalsAddress: string;
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

  /**
   * Fetch the cat's CURRENT on-chain location — outpoint (txid +
   * vout) and owning ordinals address. Two-step lookup:
   *   1. `/cat/N` → get the cat's inscription id
   *   2. `/inscription/{id}` → get satpoint + address
   *
   * Returns null when the cat doesn't exist OR when the returned
   * satpoint has an unspendable-shape (address=null; the cat's
   * "free" state — sat has been sent to OP_RETURN or fee).
   *
   * Used by the listings module to (a) verify that a would-be seller
   * actually controls the cat at insert time and (b) periodically
   * prune listings whose cats have moved since being listed.
   */
  async getCatCurrentLocation(catNumber: number): Promise<CatCurrentLocation | null> {
    const cat = await this.getCat(catNumber);
    if (!cat) return null;
    const insc = await this.fetchJson<OrdInscriptionDetail>(
      `${this.baseUrl}/inscription/${cat.id}`,
      true,
    );
    if (!insc || !insc.address) return null;
    const parsed = parseSatpoint(insc.satpoint);
    if (!parsed) return null;
    return {
      txid: parsed.txid,
      vout: parsed.vout,
      ordinalsAddress: insc.address,
    };
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

/**
 * Parse ord's `"TXID:VOUT:OFFSET"` satpoint string. Only txid + vout
 * are load-bearing here (the offset within the UTXO isn't needed for
 * outpoint identity). Returns null on malformed input so a corrupt
 * ord response doesn't crash the whole listings verification.
 */
export function parseSatpoint(satpoint: string): { txid: string; vout: number } | null {
  const parts = satpoint.split(':');
  if (parts.length !== 3) return null;
  const [txid, voutRaw] = parts;
  if (!/^[0-9a-f]{64}$/i.test(txid)) return null;
  const vout = Number.parseInt(voutRaw, 10);
  if (!Number.isInteger(vout) || vout < 0) return null;
  return { txid: txid.toLowerCase(), vout };
}
