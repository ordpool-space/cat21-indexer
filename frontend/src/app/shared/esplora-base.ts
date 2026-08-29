/**
 * The electrs (esplora) REST base the app talks to, derived from the SDK's
 * single URL source `cat21Config.mempoolApiUrl`. Centralised so the `/api`
 * path convention lives in ONE place: every esplora consumer (cat-UTXO
 * lookup, the watch-only probe) resolves the same host from the same rule,
 * and the regtest harness only has to patch `cat21Config` to redirect them
 * all. A one-sided edit at a call site can no longer point one service at
 * the wrong host.
 */
export function esploraApiBase(config: { mempoolApiUrl: string }): string {
  return config.mempoolApiUrl + '/api';
}
