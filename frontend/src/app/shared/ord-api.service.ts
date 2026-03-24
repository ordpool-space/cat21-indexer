import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { environment } from '../../environments/environment';

export interface OrdCatInfo {
  address: string | null;
}

export interface OrdBlockResponse {
  ids: string[];
  cat_numbers: number[];
  more: boolean;
  page_index: number;
}

export interface OrdAddressResponse {
  outputs: string[];
  cats: string[];
  cat_numbers: number[];
  sat_balance: number;
}

export interface OrdSatResponse {
  address: string | null;
  block: number;
  cat_numbers: number[];
  cats: string[];
  charms: string[];
  name: string;
  number: number;
  rarity: string;
}

/**
 * Direct client for ord.cat21.space — fetches live data
 * that is NOT stored in our backend (e.g., current owner).
 */
@Injectable({ providedIn: 'root' })
export class OrdApiService {
  private http = inject(HttpClient);

  getCurrentOwner(catNumber: number): Observable<string | null> {
    return this.http
      .get<OrdCatInfo>(`${environment.ordExplorer}/cat/${catNumber}`, {
        headers: { Accept: 'application/json' },
      })
      .pipe(map((info) => info.address));
  }

  getBlock(height: number, page = 0): Observable<OrdBlockResponse> {
    return this.http.get<OrdBlockResponse>(
      `${environment.ordExplorer}/inscriptions/block/${height}`,
      { headers: { Accept: 'application/json' }, params: page > 0 ? { page } : {} },
    );
  }

  getAddress(address: string): Observable<OrdAddressResponse> {
    return this.http.get<OrdAddressResponse>(
      `${environment.ordExplorer}/address/${address}`,
      { headers: { Accept: 'application/json' } },
    );
  }

  getSat(sat: number): Observable<OrdSatResponse> {
    return this.http.get<OrdSatResponse>(
      `${environment.ordExplorer}/sat/${sat}`,
      { headers: { Accept: 'application/json' } },
    );
  }
}
