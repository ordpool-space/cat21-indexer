// Regtest environment for the central local regtest stack (workspace-root
// regtest/). Every backend points at the regtest Docker services, whose host
// ports mirror the prod cloudflared tunnel targets:
//
//   api (cat21-indexer backend)  :3333  (= backend2.cat21.space)
//   ordExplorer (cat21-ord)      :8080  (= ord.cat21.space)
//   ordFullExplorer (full ord)   :3838  (= ord.ordpool.space)
//   ordpoolExplorer (frontend)   :4200  (the local ordpool frontend)
//
// URLs derive from the page's OWN hostname at load time, so one build works
// whether you open http://localhost:4221 on this machine or http://<lan-ip>:4221
// from another device through the nginx dev-proxy (forward the backend ports the
// same way). Distinct ports keep the sat-page inscription iframe
// (ordFullExplorer/preview/<id>) cross-origin-isolated from the SPA, which the
// sat-page security model requires.
const host = typeof location !== 'undefined' ? location.hostname : 'localhost';

export const environment = {
  production: false,
  api: `http://${host}:3333`,
  ordpoolExplorer: `http://${host}:4200`,
  ordExplorer: `http://${host}:8080`,
  /**
   * Full ord instance (indexes all inscriptions). ordExplorer only indexes
   * CAT-21 cats, so the sat page reads regular inscriptions from here and
   * renders their previews via /preview/<id> inside a sandboxed iframe. The
   * regtest full ord is the ord-stock container (plain ord, no --index-cat21).
   */
  ordFullExplorer: `http://${host}:3838`,
};
