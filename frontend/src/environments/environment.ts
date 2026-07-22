export const environment = {
  production: false,
  api: 'http://localhost:3333',
  ordpoolExplorer: 'https://ordpool.space',
  ordExplorer: 'https://ord.cat21.space',
  /**
   * Full ord instance — indexes all inscriptions. ord.cat21.space
   * (ordExplorer) only indexes CAT-21 cats, so the sat page reads the
   * regular inscriptions living on a sat from here and renders their
   * previews via its /preview/<id> route inside a sandboxed iframe.
   */
  ordFullExplorer: 'https://ord.ordpool.space',
  /**
   * Esplora (electrs) endpoint for second-source verification of cat
   * UTXO data. Used by CatUtxoLookupService to cross-check the
   * scriptPubKey + owning address returned by ord.cat21.space — if the
   * two oracles disagree on the same outpoint, the lookup fails closed.
   * Audit finding C1.
   */
  esploraApi: 'https://api.ordpool.space/api',
};
