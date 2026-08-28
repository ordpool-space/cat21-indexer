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
 * Both flows read the cat's ACTUAL UTXO value from electrs (our own
 * Bitcoin Core node — the authority for the amount a signature commits
 * to). 546 sats is the SDK/wallet mint POSTAGE, a builder convention and
 * NOT a chain invariant (see SDK-3): a cat rides the first sat of the
 * first output per ordinal theory, and that output can be any size a
 * third-party minter chose. The SDK transfer/offer builder enforces its
 * own `value === CAT21_POSTAGE_SATS` (546) postage rule, so passing the
 * real value makes a non-546 cat fail cleanly at build time
 * ("must equal 546; got X") rather than produce a PSBT signed over the
 * wrong amount that fails opaquely at broadcast (script-verify).
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
        // Derive the cat number from the inscription's own
        // /inscription/<id> response (`insc.number`) rather than
        // positional-pairing against addressInfo.cat_numbers[i]. In
        // cat21-ord mode the inscription index only contains cats, so
        // inscription number == cat number by construction. Pairing by
        // index breaks silently if ord ever changes the order of one
        // array vs the other (e.g. sorts cats by satpoint but keeps
        // cat_numbers numeric); pulling number and satpoint from the
        // same per-inscription round-trip removes that coupling.
        const lookups = addressInfo.cats.map((inscriptionId) =>
          this.ordApi.getInscription(inscriptionId).pipe(
            switchMap<OrdInscriptionResponse, Observable<MyCatHolding | null>>((insc) => {
              const parsed = parseSatpoint(insc.satpoint);
              if (!parsed) return of(null);
              // Read the cat UTXO's ACTUAL value from electrs — never
              // assume 546 (that is mint postage, a builder convention,
              // not a chain invariant). The SDK builder enforces its own
              // 546 rule, so a non-546 cat fails cleanly at build.
              return this.fetchEsploraTx(parsed.txid).pipe(
                map<EsploraTxResponse, MyCatHolding | null>((tx) => {
                  const out = tx.vout?.[parsed.vout];
                  if (!out) return null;
                  return {
                    catNumber: insc.number,
                    txid: parsed.txid,
                    vout: parsed.vout,
                    value: out.value,
                    inscriptionId,
                  };
                }),
              );
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
                    // The cat UTXO's ACTUAL value from electrs (already
                    // fetched + cross-checked on scriptPubKey above). The
                    // seller signs this input over this amount, so it must
                    // be the real value, never an assumed 546.
                    value: esploraOut.value,
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
