export const environment = {
  production: true,
  api: 'https://backend2.cat21.space',
  ordpoolExplorer: 'https://ordpool.space',
  ordExplorer: 'https://ord.cat21.space',
  /**
   * Esplora (electrs) endpoint for second-source verification of cat
   * UTXO data. Used by CatUtxoLookupService to cross-check the
   * scriptPubKey + owning address returned by ord.cat21.space — if the
   * two oracles disagree on the same outpoint, the lookup fails closed.
   * Audit finding C1.
   */
  esploraApi: 'https://api.ordpool.space/api',
};
