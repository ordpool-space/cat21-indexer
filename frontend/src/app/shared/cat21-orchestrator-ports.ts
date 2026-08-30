import { firstValueFrom } from 'rxjs';
import { Cat21Service, ContentScanPort, Network, TxnOutput, classifyOutpoint } from 'ordpool-sdk';

/**
 * The framework-agnostic orchestrators (Cat21MintOrchestrator etc.) are plain
 * classes constructed with injected ports. cat21.space wires the SAME four
 * ports for mint / transfer / offer, so they live here once:
 *
 *  - `getUtxos`   -> `Cat21Service.getUtxos` (spendable coins at the payment address, electrs)
 *  - `scan`       -> the SDK's `classifyOutpoint` (full ord + cat21-ord content
 *                    classify), mapped to the port's `'clean' | 'has-assets'`
 *                    verdict. Framework-agnostic, so this shared helper wires the
 *                    same scan port for every consumer without needing an Angular
 *                    `UtxoContentScanner` instance.
 *  - `broadcast`  -> `Cat21Service.postTransaction` (resolves to the txid)
 *  - `network`    -> the app's configured Bitcoin network
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
}

export function cat21OrchestratorPorts(
  cat21: Cat21Service,
  ordApiUrl: string,
  cat21OrdApiUrl: string,
  network: Network,
): Cat21OrchestratorPorts {
  return {
    getUtxos: (paymentAddress) => firstValueFrom(cat21.getUtxos(paymentAddress)),
    scan: {
      classify: async (outpoint) =>
        (await classifyOutpoint(outpoint, { ordApiUrl, cat21OrdApiUrl })).clean ? 'clean' : 'has-assets',
    },
    broadcast: (signedTxHex) => firstValueFrom(cat21.postTransaction(signedTxHex)),
    network,
  };
}
