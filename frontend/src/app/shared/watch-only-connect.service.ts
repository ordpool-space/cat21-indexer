import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, firstValueFrom, of, switchMap } from 'rxjs';
import { AddressProbe, WalletInfo, WalletService, WatchOnlyScriptType } from 'ordpool-sdk';

import { environment } from '../../environments/environment';
import { OrdApiService } from './ord-api.service';

/** One spendable output as esplora `/address/:a/utxo` returns it. */
interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
}

/**
 * Watch-only (xpub) connect for cat21.space.
 *
 * Owns the one piece the SDK leaves to the consumer: the `probe`. The SDK
 * derives the receive window and auto-picks the ordinals + payment
 * identities; the consumer answers "what is on-chain at this address"
 * per derived address. We wire that to electrs (funded / fundedSats) and
 * ord (hasCat), so the Genesis Cat is auto-picked as the ordinals
 * identity even when it does not sit at receive index 0.
 *
 * `connectXpub` returns a normal `WalletInfo` on `connectedWallet$`;
 * every existing flow then works, EXCEPT the signing step, which routes
 * through the export/paste bridge (`promptForSignedPsbt`) because a
 * watch-only wallet holds no key in the browser.
 */
@Injectable({ providedIn: 'root' })
export class WatchOnlyConnectService {
  private walletService = inject(WalletService);
  private http = inject(HttpClient);
  private ordApi = inject(OrdApiService);

  /** True when the SDK rejected a plain xpub/tpub for missing script type. */
  static isScriptTypeAmbiguous(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /script-type-ambiguous/.test(msg);
  }

  /**
   * Connect a watch-only wallet from a pasted account extended public key.
   * Pass `scriptType` for a plain xpub/tpub (the SDK throws a
   * script-type-ambiguous error otherwise; catch it with
   * {@link isScriptTypeAmbiguous} and re-call with the user's choice).
   * A SLIP-132 prefix (ypub/zpub/…) implies the type, so omit it there.
   */
  connect(extendedPublicKey: string, scriptType?: WatchOnlyScriptType): Observable<WalletInfo> {
    return this.walletService.connectXpub({
      extendedPublicKey: extendedPublicKey.trim(),
      scriptType,
      probe: (address) => this.probe(address),
    });
  }

  /**
   * On-chain state of one derived address. `funded` / `fundedSats` come
   * from electrs; `hasCat` from ord's per-address cat list (best-effort:
   * an ord miss degrades to "no cat", never blocks the scan).
   */
  private async probe(address: string): Promise<AddressProbe> {
    const utxos = await firstValueFrom(
      this.http.get<EsploraUtxo[]>(`${environment.esploraApi}/address/${address}/utxo`).pipe(
        catchError(() => of([] as EsploraUtxo[])),
      ),
    );
    const fundedSats = utxos.reduce((sum, u) => sum + u.value, 0);

    const hasCat = await firstValueFrom(
      this.ordApi.getAddress(address).pipe(
        switchMap((info) => of((info.cats?.length ?? 0) > 0)),
        catchError(() => of(false)),
      ),
    );

    return { funded: utxos.length > 0, fundedSats, hasCat };
  }
}
