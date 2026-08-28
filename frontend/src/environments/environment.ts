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
};
