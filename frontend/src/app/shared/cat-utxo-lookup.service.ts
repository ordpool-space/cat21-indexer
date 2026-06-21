import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { hex } from '@scure/base';
import { BuyOfferTargetCat, Cat21Holding } from 'ordpool-sdk';

import { environment } from '../../environments/environment';
import { ApiService } from './cat21-api/api/api.service';
import { OrdApiService, OrdInscriptionResponse, OrdOutputResponse } from './ord-api.service';

/**
 * Esplora's `/tx/<txid>` response shape (subset). The `vout` array
 * carries the scriptPubKey hex + the decoded address per output.
 * We only consume the entry at the cat's vout for the cross-check.
 */
interface EsploraTxResponse {
  txid: string;
  vout: {
    scriptpubkey: string;
    scriptpubkey_address?: string;
    value: number;
  }[];
}

/**
 * A cat the connected wallet currently owns, ready to feed into
 * `Cat21TransferOrchestrator.setCatUtxo` or
 * `Cat21AcceptOfferOrchestrator.setExpectedCatUtxo`. Adds the
 * inscription ID for UI labels ("Cat #42") on top of the orchestrator's
 * raw shape.
 */
export interface MyCatHolding extends Cat21Holding {
  inscriptionId: string;
}

/**
 * Translates from "user-visible cat identity" (a cat number) to the
 * orchestrator-required `Cat21Holding` / `BuyOfferTargetCat` shape that
 * carries the cat's CURRENT on-chain location. Backed by cat21-ord's
 * `/inscription/<id>` and `/output/<outpoint>` endpoints.
 *
 * Two flows:
 *
 * 1. **`getMyHoldings(ordinalsAddress)`** — for the connected user's
 *    own cats (transfer + seller-side accept-offer pages). Pulls the
 *    cat numbers + inscription IDs from the existing `OrdAddressResponse`,
 *    then expands each into a holding by querying the inscription's
 *    current satpoint.
 *
 * 2. **`getTargetByNumber(catNumber)`** — for the make-offer page,
 *    where the buyer types a number and we look up the seller's
 *    on-chain state. Returns the cat's current outpoint + scriptPubKey
 *    + owning address.
 *
 * Both flows assume the cat is at a 546-sat UTXO (CAT-21 protocol
 * invariant); we don't double-check the value here, the orchestrator's
 * own assert catches a mismatch with a clean error.
 */
@Injectable({ providedIn: 'root' })
export class CatUtxoLookupService {
  private ordApi = inject(OrdApiService);
  private cat21Api = inject(ApiService);
  private http = inject(HttpClient);

  /**
   * For each cat at the supplied ordinals address (typically the
   * connected wallet's), returns the cat's current UTXO outpoint
   * ready to drive the transfer or accept-offer orchestrators.
   *
   * One ord round-trip for the address listing + one per cat for the
   * inscription's satpoint. For typical wallets holding < 50 cats the
   * fan-out is fine; for whale wallets the consumer should paginate
   * (out of scope here).
   */
  getMyHoldings(ordinalsAddress: string): Observable<MyCatHolding[]> {
    return this.ordApi.getAddress(ordinalsAddress).pipe(
      switchMap((addressInfo) => {
        if (!addressInfo.cats || addressInfo.cats.length === 0) {
          return of([] as MyCatHolding[]);
        }
        const lookups = addressInfo.cats.map((inscriptionId, i) =>
          this.ordApi.getInscription(inscriptionId).pipe(
            map<OrdInscriptionResponse, MyCatHolding | null>((insc) => {
              const parsed = parseSatpoint(insc.satpoint);
              if (!parsed) return null;
              return {
                catNumber: addressInfo.cat_numbers[i],
                txid: parsed.txid,
                vout: parsed.vout,
                value: 546,
                inscriptionId,
              };
            }),
          ),
        );
        return forkJoin(lookups).pipe(
          map((holdings) => holdings.filter((h): h is MyCatHolding => h !== null)),
        );
      }),
    );
  }

  /**
   * Look up a cat by its number for the buyer-side make-offer flow.
   * Returns the orchestrator-ready `BuyOfferTargetCat` (txid, vout,
   * value, scriptPubKey) plus the seller's current owning address so
   * the make-offer page can pre-fill the seller-payment-address input.
   *
   * **Trust model (audit C1):** the cat's current location and
   * scriptPubKey are sourced from `ord.cat21.space` AND verified
   * against electrs (`api.ordpool.space/api/tx/<txid>`). If the two
   * oracles disagree on scriptPubKey or owning address for the same
   * outpoint, the lookup fails closed (returns null). Electrs lives
   * in a separate trust domain from ord-proxy (electrs = our own
   * Bitcoin Core indexer; ord-proxy = scrape of ordinals.com), so a
   * compromise of one does not silently affect the other.
   *
   * Four round-trips: indexer for cat number → mint txHash;
   * ord for inscription → current satpoint; ord for output →
   * scriptPubKey + owning address; electrs for the same tx → vout
   * scriptpubkey + address.
   */
  getTargetByNumber(catNumber: number): Observable<{
    target: BuyOfferTargetCat;
    sellerAddress: string;
  } | null> {
    return this.cat21Api.catsControllerGetCatByNumber(catNumber).pipe(
      switchMap<{ txHash: string }, Observable<{ target: BuyOfferTargetCat; sellerAddress: string } | null>>((catDto) => {
        const inscriptionId = `${catDto.txHash.toLowerCase()}i0`;
        return this.ordApi.getInscription(inscriptionId).pipe(
          switchMap<OrdInscriptionResponse, Observable<{ target: BuyOfferTargetCat; sellerAddress: string } | null>>((insc) => {
            if (!insc.address) return of(null);
            const parsed = parseSatpoint(insc.satpoint);
            if (!parsed) return of(null);
            const sellerAddress = insc.address;
            const outpoint = `${parsed.txid}:${parsed.vout}`;
            // Two parallel oracle queries.
            return forkJoin({
              ord: this.ordApi.getOutput(outpoint),
              esplora: this.fetchEsploraTx(parsed.txid),
            }).pipe(
              map<{ ord: OrdOutputResponse; esplora: EsploraTxResponse }, { target: BuyOfferTargetCat; sellerAddress: string } | null>((sources) => {
                const ord = sources.ord;
                if (!ord.script_pubkey) return null;
                const esploraOut = sources.esplora.vout?.[parsed.vout];
                if (!esploraOut) return null;
                // Cross-check: scriptPubKey bytes must match between the
                // two oracles. Without this gate a compromised ord-proxy
                // could substitute attacker bytes for the buyer to sign
                // against. Esplora is our own electrs, independent trust.
                const ordScriptLower = ord.script_pubkey.toLowerCase();
                const esploraScriptLower = esploraOut.scriptpubkey.toLowerCase();
                if (ordScriptLower !== esploraScriptLower) return null;
                // Cross-check the owning address too when esplora can
                // decode it (some script types don't yield an address;
                // skip the address check in those cases — the script
                // bytes match is the load-bearing assertion).
                if (
                  esploraOut.scriptpubkey_address
                  && esploraOut.scriptpubkey_address !== sellerAddress
                ) {
                  return null;
                }
                let scriptBytes: Uint8Array;
                try {
                  scriptBytes = hex.decode(ordScriptLower);
                } catch {
                  return null;
                }
                return {
                  target: {
                    catNumber,
                    txid: parsed.txid,
                    vout: parsed.vout,
                    value: 546,
                    scriptPubKey: scriptBytes,
                  },
                  sellerAddress,
                };
              }),
            );
          }),
        );
      }),
    );
  }

  private fetchEsploraTx(txid: string): Observable<EsploraTxResponse> {
    return this.http.get<EsploraTxResponse>(
      `${environment.esploraApi}/tx/${txid}`,
      { headers: { Accept: 'application/json' } },
    );
  }
}

/**
 * Bitcoin's `vout` field is a uint32. Cap the parsed value here so a
 * satpoint with `vout=999999999999` doesn't slip past Number.parseInt's
 * silent precision loss and poison the orchestrator's PSBT builder.
 * Audit finding L1.
 */
const MAX_VOUT = 0xffffffff;

function parseSatpoint(satpoint: string): { txid: string; vout: number } | null {
  // Satpoint is "txid:vout:offset" — offset is always 0 for CAT-21 per FIFO,
  // we don't validate it here, only extract the outpoint.
  const m = satpoint.match(/^([0-9a-fA-F]{64}):(\d+):\d+$/);
  if (!m) return null;
  const vout = Number.parseInt(m[2], 10);
  if (!Number.isFinite(vout) || vout < 0 || vout > MAX_VOUT) return null;
  return { txid: m[1].toLowerCase(), vout };
}
