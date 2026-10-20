import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { and, count, desc, eq } from 'drizzle-orm';
import { validateCat21BuyOfferPsbt, verifyOfferInputSignatures } from 'ordpool-sdk/cat21-validation';

import { catsArraysEqual } from '../shared/array-utils';
import {
  BackendNetworkString,
  readBackendNetworkFromEnv,
  toSdkNetwork,
} from '../shared/backend-network';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { throwCatNotFound, throwOrdLookupFailed } from '../shared/marketplace-errors';
import { paginationOffset } from '../shared/pagination';
import { bids } from '../shared/drizzle/schema/bids';
import { ElectrsClientService } from '../sync/electrs-client.service';
import { OrdClientService } from '../sync/ord-client.service';
import { BidDto, PaginatedBidsDto } from './dto/bid.dto';
import { CreateBidDto } from './dto/create-bid.dto';

/**
 * Marketplace spam floor. Bids below this are rejected outright — a
 * useful anti-spam gate before we spend electrs cycles on liveness
 * checks. Tuned to be well below any realistic cat price today
 * (1 000 sats ≈ $0.60) while still filtering "0-sat troll bids" that
 * cost the seller nothing to accept and pollute the display.
 */
const MARKETPLACE_FLOOR_SATS = 1_000;

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name);
  private readonly backendNetwork: BackendNetworkString = readBackendNetworkFromEnv();

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
    private readonly electrsClient: ElectrsClientService,
  ) {
    this.logger.log(`BidsService: BACKEND_NETWORK = ${this.backendNetwork}`);
  }

  get network(): BackendNetworkString {
    return this.backendNetwork;
  }

  /**
   * Post (or overwrite) a buyer's bid on a cat UTXO.
   *
   * Check order — CHEAP → EXPENSIVE:
   *
   *   1. Network match.
   *   2. Headline membership (headline ∈ cats).
   *   3. Floor price (spam guard).
   *   4. PSBT decode + input/output count shape gates the SDK doesn't cap.
   *   5. SDK validateCat21BuyOfferPsbt — single source of truth for the
   *      full PSBT-vs-DTO consistency chain (seller input, sighash,
   *      buyer signatures, seller payment address + floor, cat output
   *      address, exact bidSats price, buyer change address).
   *   6. Electrs — buyer inputs must be live outpoints (phantom-input
   *      rejection).
   *   7. Ord `/output/<outpoint>` — cats-bundle drift check.
   *   8. Upsert.
   */
  async create(dto: CreateBidDto): Promise<BidDto> {
    // (1) Network fail-fast.
    if (dto.network !== this.backendNetwork) {
      throw new BadRequestException({
        code: 'network-mismatch',
        detail: `Bid targets network=${dto.network}; this backend serves ${this.backendNetwork}.`,
      });
    }

    // (2) Headline membership.
    if (!dto.cats.includes(dto.headlineCatNumber)) {
      throw new BadRequestException({
        code: 'headline-not-in-bundle',
        detail: `headlineCatNumber ${dto.headlineCatNumber} is not a member of cats [${dto.cats.join(',')}]`,
      });
    }

    // (3) Marketplace floor.
    if (dto.bidSats < MARKETPLACE_FLOOR_SATS) {
      throw new BadRequestException({
        code: 'bid-below-marketplace-floor',
        detail:
          `bidSats=${dto.bidSats} is below the marketplace floor of ${MARKETPLACE_FLOOR_SATS} sats. ` +
          'Very-low-price bids are rejected as spam.',
      });
    }

    // (4) PSBT decode + shape.
    let psbtBytes: Uint8Array;
    try {
      psbtBytes = base64.decode(dto.psbtBase64);
    } catch (err) {
      throw new BadRequestException({
        code: 'psbt-malformed',
        detail: `PSBT base64 decode failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    let tx: btc.Transaction;
    try {
      tx = btc.Transaction.fromPSBT(psbtBytes, {
        allowUnknowInput: true,
        allowUnknowOutput: true,
      });
    } catch (err) {
      throw new BadRequestException({
        code: 'psbt-malformed',
        detail: `PSBT parse failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // (5) Shape guards not covered by the SDK validator. The SDK
    //     iterates buyer inputs from index 1..N so a 1-input PSBT
    //     silently passes its buyer-signature loop; a marketplace
    //     bid MUST have at least one buyer funding input. The SDK
    //     also doesn't cap the upper output count, but a legitimate
    //     buy-offer has exactly 2 or 3 outputs (cat, seller-payment,
    //     optional buyer-change); more is either malformed or an
    //     unknown protocol variant we don't index.
    if (tx.inputsLength < 2) {
      throw new BadRequestException({
        code: 'psbt-shape-invalid',
        detail: 'PSBT must have input 0 = seller cat UTXO plus at least one buyer funding input',
      });
    }
    if (tx.outputsLength < 2 || tx.outputsLength > 3) {
      throw new BadRequestException({
        code: 'psbt-shape-invalid',
        detail: 'PSBT must have 2 or 3 outputs (cat, seller-payment, optional buyer-change)',
      });
    }

    const sdkNetwork = toSdkNetwork(dto.network);

    // (6) Structural SDK gate — parses the PSBT and checks every semantic
    //     invariant against the DTO (input 0 outpoint, seller-input postage,
    //     sighash field + signature flag byte, buyer signatures present,
    //     Output 0 postage + script, Output 1 address + floor, Output 2
    //     buyer-change address, exact-price). No chain yet: a DTO/shape
    //     mismatch is cheap to catch and must surface as its own reason
    //     before any electrs round-trip.
    const sdkResult = validateCat21BuyOfferPsbt({
      psbt: psbtBytes,
      expectedSellerUtxo: { txid: dto.catTxid, vout: dto.catVout },
      floorPriceSats: 0,
      expectedSellerPaymentAddress: dto.sellerPaymentAddress as never,
      expectedBuyerReceiveAddress: dto.buyerOrdinalsAddress as never,
      expectedBuyerChangeAddress: dto.buyerPaymentAddress as never,
      expectedExactPrice: dto.bidSats,
      network: sdkNetwork,
    });
    if (!sdkResult.ok) {
      throw new BadRequestException({
        code: `psbt-${sdkResult.reason}`,
        detail: sdkResult.detail ?? `SDK validator rejected: ${sdkResult.reason}`,
      });
    }

    // (6a) Fetch the TRUE prevout of every input from electrs. The PSBT's own
    //      witnessUtxo is attacker-controlled and must never be the source for
    //      a sighash, so the chain prevout is read here and the crypto gate
    //      (6c) verifies against it. Fail CLOSED: a phantom txid (not-found)
    //      is unspendable, and an electrs blip (unknown) is rejected too — a
    //      bid we cannot verify against the chain is not accepted (the buyer
    //      retries). The spend probe (6b) still runs for the spent-vout case a
    //      `/tx` read cannot see (a consumed output's tx still exists).
    const prevouts = new Map<string, { script: Uint8Array; amountSats: number }>();
    for (let i = 0; i < tx.inputsLength; i++) {
      const op = this.inputOutpoint(tx, i);
      if (!op) continue;
      const { txid: inpTxid, vout: inpVout } = op;
      const pv = await this.electrsClient.getPrevout(inpTxid, inpVout);
      if (pv === 'not-found') {
        throw new BadRequestException({
          code: 'psbt-buyer-input-unspendable',
          detail:
            `PSBT input ${i} (${inpTxid}:${inpVout}) is unspendable — the txid is unknown to ` +
            'electrs (never broadcast / orphaned) or the vout is out of range.',
        });
      }
      if (pv === 'unknown') {
        throw new BadRequestException({
          code: 'prevout-fetch-failed',
          detail:
            `Could not read input ${i} (${inpTxid}:${inpVout}) from the chain to verify the ` +
            'bid signatures. Transient; retry in a moment.',
        });
      }
      prevouts.set(`${inpTxid}:${inpVout}`, pv);
    }

    // (6c) Cryptographic gate: pin each witnessUtxo to the chain prevout and
    //      verify every buyer signature against the real BIP-143/341 sighash.
    //      This is what turns "a signature is present" (6) into "the signature
    //      is real and spends the coin it names" — a bid with random bytes as
    //      its signature, or a lied-about input value, is rejected here.
    const sigResult = verifyOfferInputSignatures(psbtBytes, prevouts);
    if (!sigResult.ok) {
      throw new BadRequestException({
        code: `psbt-${sigResult.reason}`,
        detail: `input ${sigResult.inputIndex}: ${sigResult.detail}`,
      });
    }

    // (6b) Buyer inputs must reference outpoints that actually exist
    //      on chain and are still spendable. Rejects the phantom-input
    //      adversarial pattern (attacker POSTs a bid whose funding
    //      inputs reference a made-up txid → getOutpointStatus returns
    //      'spent' for the phantom → reject at insert). Legitimate bids
    //      always pass: the
    //      buyer wouldn't have been able to sign against a UTXO
    //      they don't own. Cost: 1..N electrs HTTP calls per POST
    //      (N = buyer input count, typically 1-3). 'unknown' (electrs
    //      blip) is fail-safe: don't reject a legitimate bid because
    //      electrs momentarily 500'd; the pruner catches truly
    //      broken bids later.
    for (let i = 1; i < tx.inputsLength; i++) {
      const op = this.inputOutpoint(tx, i);
      if (!op) continue;
      const { txid: inpTxid, vout: inpVout } = op;
      const status = await this.electrsClient.getOutpointStatus(inpTxid, inpVout);
      if (status === 'spent') {
        throw new BadRequestException({
          code: 'psbt-buyer-input-unspendable',
          detail:
            `PSBT input ${i} (${inpTxid}:${inpVout}) is unspendable — either the txid is ` +
            `unknown to electrs (never broadcast / orphaned) or the vout was already spent.`,
        });
      }
      // 'unspent' → ok, continue.
      // 'unknown' → fail-safe, don't reject a legitimate bid on an
      //             electrs blip. Pruner catches this later if the
      //             input is truly bad.
    }

    // (7) Ord cats-bundle check.
    let liveCats: number[] | null;
    try {
      liveCats = await this.ordClient.getCatsAtOutput(dto.catTxid, dto.catVout);
    } catch (err) {
      this.logger.warn(`ord /output lookup failed for ${dto.catTxid}:${dto.catVout}: ${err instanceof Error ? err.message : err}`);
      throwOrdLookupFailed();
    }
    if (liveCats === null || liveCats.length === 0) {
      throwCatNotFound(
        `UTXO ${dto.catTxid}:${dto.catVout} carries no cats on ord (already spent, unknown, ` +
          'or never held a cat).',
      );
    }
    if (!catsArraysEqual(liveCats, dto.cats)) {
      throw new BadRequestException({
        code: 'cats-bundle-drift',
        detail:
          `Buyer signed for cats=[${dto.cats.join(',')}] but the UTXO now carries ` +
          `[${liveCats.join(',')}]. Re-bid against the current bundle.`,
      });
    }

    // (8) Upsert.
    const catsSorted = [...new Set(dto.cats)].sort((a, b) => a - b);
    await this.drizzle.db
      .insert(bids)
      .values({
        network: dto.network,
        catTxid: dto.catTxid,
        catVout: dto.catVout,
        catsOnUtxo: catsSorted,
        headlineCatNumber: dto.headlineCatNumber,
        bidSats: dto.bidSats,
        buyerOrdinalsAddress: dto.buyerOrdinalsAddress,
        buyerPaymentAddress: dto.buyerPaymentAddress,
        sellerPaymentAddress: dto.sellerPaymentAddress,
        psbtBase64: dto.psbtBase64,
      })
      .onDuplicateKeyUpdate({
        set: {
          catsOnUtxo: catsSorted,
          headlineCatNumber: dto.headlineCatNumber,
          bidSats: dto.bidSats,
          buyerPaymentAddress: dto.buyerPaymentAddress,
          sellerPaymentAddress: dto.sellerPaymentAddress,
          psbtBase64: dto.psbtBase64,
        },
      });

    // Read-back — MySQL doesn't surface the row on ON DUPLICATE KEY UPDATE.
    const persisted = await this.findByOutpointAndBuyer(
      dto.network,
      dto.catTxid,
      dto.catVout,
      dto.buyerOrdinalsAddress,
    );
    if (!persisted) {
      throw new BadRequestException({
        code: 'persist-race',
        detail: 'Bid was accepted but disappeared before read-back. Retry.',
      });
    }
    return persisted;
  }

  /**
   * Every active bid on a given UTXO, sorted by `bidSats` DESC then
   * `createdAt` DESC (ties broken by most-recent). The seller's view:
   * "who's offering the most right now".
   */
  /** The (network, cat outpoint) predicates every single-outpoint query shares. */
  private outpointPredicates(network: string, catTxid: string, catVout: number) {
    return [eq(bids.network, network), eq(bids.catTxid, catTxid), eq(bids.catVout, catVout)];
  }

  /** The (txid, vout) of PSBT input `i`, or null when the input carries no txid. */
  private inputOutpoint(tx: btc.Transaction, i: number): { txid: string; vout: number } | null {
    const inp = tx.getInput(i);
    if (!inp.txid) return null;
    return { txid: hex.encode(inp.txid), vout: inp.index ?? 0 };
  }

  async findByOutpoint(network: string, catTxid: string, catVout: number): Promise<BidDto[]> {
    const rows = await this.drizzle.db
      .select()
      .from(bids)
      .where(and(...this.outpointPredicates(network, catTxid, catVout)))
      .orderBy(desc(bids.bidSats), desc(bids.createdAt));
    return rows.map((r) => this.rowToDto(r));
  }

  /**
   * The unique-key lookup. Used for read-back post-insert.
   */
  async findByOutpointAndBuyer(
    network: string,
    catTxid: string,
    catVout: number,
    buyerOrdinalsAddress: string,
  ): Promise<BidDto | null> {
    const rows = await this.drizzle.db
      .select()
      .from(bids)
      .where(
        and(
          ...this.outpointPredicates(network, catTxid, catVout),
          eq(bids.buyerOrdinalsAddress, buyerOrdinalsAddress),
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return this.rowToDto(rows[0]);
  }

  /**
   * Paginated feed of all active bids across the whole marketplace,
   * most-recently-posted first. Bounded page size same as listings.
   */
  async findPaginated(itemsPerPage: number, currentPage: number): Promise<PaginatedBidsDto> {
    const offset = paginationOffset(itemsPerPage, currentPage);
    const [rows, [{ total }]] = await Promise.all([
      this.drizzle.db
        .select()
        .from(bids)
        .orderBy(desc(bids.createdAt))
        .limit(itemsPerPage)
        .offset(offset),
      this.drizzle.db.select({ total: count() }).from(bids),
    ]);
    return {
      total,
      currentPage,
      itemsPerPage,
      items: rows.map((r) => this.rowToDto(r)),
    };
  }

  /**
   * Delete by (network, cat_txid, cat_vout, buyer). Used by an
   * eventual buyer-side cancel flow AND by the pruner when a bid
   * is stale (cat moved OR buyer inputs spent elsewhere).
   */
  async deleteByOutpointAndBuyer(
    network: string,
    catTxid: string,
    catVout: number,
    buyerOrdinalsAddress: string,
  ): Promise<void> {
    await this.drizzle.db
      .delete(bids)
      .where(
        and(
          eq(bids.network, network),
          eq(bids.catTxid, catTxid),
          eq(bids.catVout, catVout),
          eq(bids.buyerOrdinalsAddress, buyerOrdinalsAddress),
        ),
      );
  }

  /**
   * Row → DTO. `createdAt` becomes an ISO-8601 string.
   */
  private rowToDto(row: typeof bids.$inferSelect): BidDto {
    return {
      id: row.id,
      network: row.network,
      catTxid: row.catTxid,
      catVout: row.catVout,
      cats: row.catsOnUtxo,
      headlineCatNumber: row.headlineCatNumber,
      bidSats: row.bidSats,
      buyerOrdinalsAddress: row.buyerOrdinalsAddress,
      buyerPaymentAddress: row.buyerPaymentAddress,
      sellerPaymentAddress: row.sellerPaymentAddress,
      psbtBase64: row.psbtBase64,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
