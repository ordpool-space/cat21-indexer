import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { environment } from '../../environments/environment';

export interface OrdCatInfo {
  address: string | null;
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
}
