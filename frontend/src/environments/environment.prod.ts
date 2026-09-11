export const environment = {
  production: true,
  api: 'https://backend2.cat21.space',
  /**
   * Base for the BTC/USD price read (`/api/v1/prices`), served by our
   * ordpool-backend (a mempool fork) at api.ordpool.space. Only used to
   * append a current-USD equivalent beside sat amounts; the sats are the
   * source of truth. Empty ⇒ the price read is skipped and the USD suffix
   * is hidden (see PriceService).
   */
  mempoolApiUrl: 'https://api.ordpool.space',
  ordpoolExplorer: 'https://ordpool.space',
  ordExplorer: 'https://ord.cat21.space',
  /**
   * Full ord instance — indexes all inscriptions. ord.cat21.space
   * (ordExplorer) only indexes CAT-21 cats, so the sat page reads the
   * regular inscriptions living on a sat from here and renders their
   * previews via its /preview/<id> route inside a sandboxed iframe.
   */
  ordFullExplorer: 'https://ord.ordpool.space',
};
