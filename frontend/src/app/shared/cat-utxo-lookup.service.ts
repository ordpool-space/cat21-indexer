import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { hex } from '@scure/base';
import { BuyOfferTargetCat, Cat21Holding } from 'ordpool-sdk';

import { ApiService } from './cat21-api/api/api.service';
import { OrdApiService, OrdInscriptionResponse, OrdOutputResponse } from './ord-api.service';

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
   * Three round-trips: indexer for cat number → mint txHash;
   * ord for inscription → current satpoint; ord for output →
   * scriptPubKey + owning address. Cached via shareReplay on the
   * indexer side; ord queries are direct.
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
            return this.ordApi.getOutput(outpoint).pipe(
              map<OrdOutputResponse, { target: BuyOfferTargetCat; sellerAddress: string } | null>((out) => {
                if (!out.script_pubkey) return null;
                let scriptBytes: Uint8Array;
                try {
                  scriptBytes = hex.decode(out.script_pubkey.toLowerCase());
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
}

function parseSatpoint(satpoint: string): { txid: string; vout: number } | null {
  // Satpoint is "txid:vout:offset" — offset is always 0 for CAT-21 per FIFO,
  // we don't validate it here, only extract the outpoint.
  const m = satpoint.match(/^([0-9a-fA-F]{64}):(\d+):\d+$/);
  if (!m) return null;
  return { txid: m[1].toLowerCase(), vout: Number.parseInt(m[2], 10) };
}
