import { firstValueFrom } from 'rxjs';
import {
  Cat21Service,
  Cat21SdkConfig,
  ContentScanPort,
  FundingTopologySetting,
  Network,
  TxnOutput,
  UtxoContentScanner,
} from 'ordpool-sdk';

/**
 * The framework-agnostic orchestrators (Cat21MintOrchestrator etc.) are plain
 * classes constructed with injected ports. cat21.space wires the SAME ports for
 * mint / transfer / offer, so they live here once:
 *
 *  - `getUtxos`   -> `Cat21Service.getUtxos` (spendable coins at the payment address, electrs)
 *  - `scan`       -> the SDK's `UtxoContentScanner`, the single-source content
 *                    adapter (full ord + cat21-ord classify). It returns the
 *                    RICH `{ verdict, assets }` form, so the funding recommendation
 *                    carries the inscription ids / rune names / cat ids / rare sat
 *                    that a notice or picker names, instead of a bare
 *                    `has-assets`. Fail-closed: an unknown / still-scanning coin
 *                    maps to `has-assets` with NO detail, so a caller can never
 *                    read absent detail as "nothing on the coin".
 *  - `broadcast`  -> `Cat21Service.postTransaction` (resolves to the txid)
 *  - `network`    -> the app's configured Bitcoin network
 *  - `fundingTopology` -> `'derive'` opts a flow into the asset-to-miner
 *                    safeguard: the orchestrator resolves the wallet's address
 *                    topology from its own wallet context, so a separate-address
 *                    wallet gets a NOTICE (proceed) and a one-address wallet a
 *                    WARNING (block) when only an asset-bearing coin covers. OMIT
 *                    it and the orchestrator blocks every wallet — the safe
 *                    default, correct for a flow whose template does not yet
 *                    render the notice.
 *
 * The offer-create orchestrator needs only `{ getUtxos, scan, network }` (it
 * builds a partial PSBT, never broadcasts); passing the full object is fine.
 * The accept-offer orchestrator needs a `broadcast` returning a full
 * `BroadcastOutcome`, so it assembles its own port from `postTransaction`.
 */
export interface Cat21OrchestratorPorts {
  getUtxos(paymentAddress: string): Promise<TxnOutput[]>;
  scan: ContentScanPort;
  broadcast(signedTxHex: string): Promise<string>;
  network: Network;
  fundingTopology?: FundingTopologySetting;
}

export function cat21OrchestratorPorts(
  cat21: Cat21Service,
  config: Cat21SdkConfig,
  network: Network,
  fundingTopology?: FundingTopologySetting,
): Cat21OrchestratorPorts {
  return {
    getUtxos: (paymentAddress) => firstValueFrom(cat21.getUtxos(paymentAddress)),
    // The whole scanner IS a ContentScanPort; it only reads the ord URLs from the
    // config. Using it (not a hand-rolled classifyOutpoint flatten) is what keeps
    // the classifier->verdict->asset-detail mapping in the ONE place the SDK owns.
    scan: new UtxoContentScanner(config),
    broadcast: (signedTxHex) => firstValueFrom(cat21.postTransaction(signedTxHex)),
    network,
    ...(fundingTopology ? { fundingTopology } : {}),
  };
}
