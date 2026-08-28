import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { WalletInfo, WalletService, WatchOnlyScriptType, makeWatchOnlyProbe } from 'ordpool-sdk';

import { environment } from '../../environments/environment';

/**
 * Watch-only (xpub) connect for cat21.space.
 *
 * The probe — the "what is on-chain at this address" lookup `scanWatchOnly`
 * needs — is the SDK's shared, ordinals-safe `makeWatchOnlyProbe`: it
 * classifies every UTXO against the full ord (inscriptions + runes + rare
 * sats) AND cat21-ord (cats), so `funded`/`fundedSats` count ONLY provably
 * clean UTXOs and `hasCat` comes from the cat index. One authoritative
 * implementation, shared across ordpool.space / cat21.space / cubes — no
 * per-consumer funded/fundedSats logic, no size heuristics. The Genesis
 * Cat (cat #0, not at receive index 0) is auto-picked as the ordinals
 * identity; a cat/inscription-only address is never picked for payment.
 *
 * `connectXpub` returns a normal `WalletInfo` on `connectedWallet$`; every
 * existing flow then works, EXCEPT the signing step, which routes through
 * the export/paste bridge (`promptForSignedPsbt`) — a watch-only wallet
 * holds no key in the browser.
 */
@Injectable({ providedIn: 'root' })
export class WatchOnlyConnectService {
  private walletService = inject(WalletService);

  /**
   * The shared ordinals-safe probe, wired to cat21.space's endpoints:
   * electrs behind `/api` (esploraApi already carries it), the full ord
   * (ordFullExplorer) for inscriptions/runes/rare-sats, and cat21-ord
   * (ordExplorer) for cats.
   */
  private readonly probe = makeWatchOnlyProbe({
    esploraApiUrl: environment.esploraApi,      // https://api.ordpool.space/api -> /address/:a/utxo
    ordApiUrl: environment.ordFullExplorer,     // https://ord.ordpool.space (inscriptions + runes + rare sats)
    cat21OrdApiUrl: environment.ordExplorer,    // https://ord.cat21.space (cats)
  });

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
      probe: this.probe,
    });
  }
}
