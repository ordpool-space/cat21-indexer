import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { WalletInfo, WalletService, WatchOnlyDeriveError, WatchOnlyScriptType, makeWatchOnlyProbe } from 'ordpool-sdk';

import { cat21Config } from './sdk-tokens';

import { esploraApiBase } from './esplora-base';

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
  private cfg = inject(cat21Config);

  /**
   * The shared ordinals-safe probe, wired from the SDK's `cat21Config` (the
   * single URL source the app provides and the regtest harness patches):
   * electrs behind `/api`, the full ord for inscriptions/runes/rare-sats,
   * and cat21-ord for cats.
   */
  private readonly probe = makeWatchOnlyProbe({
    esploraApiUrl: esploraApiBase(this.cfg),  // electrs -> /address/:a/utxo
    ordApiUrl: this.cfg.ordApiUrl,                   // full ord (inscriptions + runes + rare sats)
    cat21OrdApiUrl: this.cfg.cat21OrdApiUrl,          // cat21-ord (cats)
  });

  /**
   * True when the SDK rejected a plain xpub/tpub for missing script type.
   * Keys on the SDK's stable typed `WatchOnlyDeriveError.code`, not the
   * human-readable message (a reworded message would silently break the
   * account-type prompt otherwise).
   */
  static isScriptTypeAmbiguous(err: unknown): boolean {
    return err instanceof WatchOnlyDeriveError && err.code === 'script-type-ambiguous';
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
