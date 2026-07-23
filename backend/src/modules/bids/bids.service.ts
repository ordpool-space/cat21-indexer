import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { and, count, desc, eq } from 'drizzle-orm';
import { CAT21_POSTAGE_SATS, Network, toScureNetwork, validateCat21BuyOfferPsbt } from 'ordpool-sdk/core';

import { catsArraysEqual } from '../shared/array-utils';
import {
  BackendNetworkString,
  readBackendNetworkFromEnv,
  toSdkNetwork,
} from '../shared/backend-network';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { bids } from '../shared/drizzle/schema/bids';
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

/**
 * Decode a scriptPubKey back into a bitcoin address for the given
 * network. Wraps scure's OutScript.decode + Address.encode. Returns
 * null on scripts we can't render (OP_RETURN, non-standard scripts).
 */
export function scriptToAddress(script: Uint8Array, network: Network): string | null {
  try {
    const decoded = btc.OutScript.decode(script);
    return btc.Address(toScureNetwork(network)).encode(decoded);
  } catch {
    return null;
  }
}

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name);
  private readonly backendNetwork: BackendNetworkString = readBackendNetworkFromEnv();

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
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
   *   4. PSBT decode + shape (input 0 = the cat UTXO, output 0 = cat →
   *      buyer, output 1 = sats → seller, output 2 = optional change).
   *   5. Client-vs-PSBT cross-check (extracted values match DTO).
   *   6. SDK validateCat21BuyOfferPsbt (SIGHASH invariants, buyer sigs).
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

    // Input 0 outpoint matches the DTO.
    const input0 = tx.getInput(0);
    const input0Txid = input0.txid ? hex.encode(input0.txid) : null;
    if (input0Txid !== dto.catTxid.toLowerCase() || input0.index !== dto.catVout) {
      throw new BadRequestException({
        code: 'psbt-input0-mismatch',
        detail:
          `PSBT input 0 = ${input0Txid}:${input0.index}, but DTO claims ${dto.catTxid}:${dto.catVout}.`,
      });
    }

    // Output 0 = cat lands here; decode address and check against buyerOrdinalsAddress.
    const out0 = tx.getOutput(0);
    if (!out0.script) {
      throw new BadRequestException({ code: 'psbt-shape-invalid', detail: 'PSBT output 0 has no script' });
    }
    if (Number(out0.amount ?? 0n) !== CAT21_POSTAGE_SATS) {
      throw new BadRequestException({
        code: 'psbt-shape-invalid',
        detail: `PSBT output 0 must be exactly ${CAT21_POSTAGE_SATS} sats (cat postage); got ${out0.amount}`,
      });
    }
    const out0Address = scriptToAddress(out0.script, sdkNetwork);
    if (!out0Address || out0Address !== dto.buyerOrdinalsAddress) {
      throw new BadRequestException({
        code: 'psbt-output0-mismatch',
        detail: `PSBT output 0 pays ${out0Address ?? 'unknown'}, DTO claims ${dto.buyerOrdinalsAddress}`,
      });
    }

    // Output 1 = seller payment.
    const out1 = tx.getOutput(1);
    if (!out1.script || out1.amount === undefined) {
      throw new BadRequestException({ code: 'psbt-shape-invalid', detail: 'PSBT output 1 has no script or amount' });
    }
    const out1Address = scriptToAddress(out1.script, sdkNetwork);
    if (!out1Address || out1Address !== dto.sellerPaymentAddress) {
      throw new BadRequestException({
        code: 'psbt-output1-mismatch',
        detail: `PSBT output 1 pays ${out1Address ?? 'unknown'}, DTO claims ${dto.sellerPaymentAddress}`,
      });
    }
    // Output 1 amount = bidSats + postage (ord-parity — seller made whole on postage).
    const expectedOut1 = dto.bidSats + CAT21_POSTAGE_SATS;
    if (Number(out1.amount) !== expectedOut1) {
      throw new BadRequestException({
        code: 'psbt-price-mismatch',
        detail: `PSBT output 1 amount = ${out1.amount} sats, expected bidSats + postage = ${expectedOut1}`,
      });
    }

    // Output 2 (optional) = buyer change.
    if (tx.outputsLength === 3) {
      const out2 = tx.getOutput(2);
      if (!out2.script) {
        throw new BadRequestException({ code: 'psbt-shape-invalid', detail: 'PSBT output 2 has no script' });
      }
      const out2Address = scriptToAddress(out2.script, sdkNetwork);
      if (!out2Address || out2Address !== dto.buyerPaymentAddress) {
        throw new BadRequestException({
          code: 'psbt-output2-mismatch',
          detail: `PSBT output 2 pays ${out2Address ?? 'unknown'}, DTO claims ${dto.buyerPaymentAddress}`,
        });
      }
    }

    // (6) SDK validate — SIGHASH_ALL invariants on buyer inputs,
    //     seller-input postage, price ≥ floor (0 here — we already
    //     enforce the marketplace floor above), address match.
    const sdkResult = validateCat21BuyOfferPsbt({
      psbt: psbtBytes,
      expectedSellerUtxo: { txid: dto.catTxid, vout: dto.catVout },
      floorPriceSats: 0,
      expectedSellerPaymentAddress: dto.sellerPaymentAddress as never,
      network: sdkNetwork,
    });
    if (!sdkResult.ok) {
      throw new BadRequestException({
        code: `psbt-${sdkResult.reason}`,
        detail: sdkResult.detail ?? `SDK validator rejected: ${sdkResult.reason}`,
      });
    }

    // (7) Ord cats-bundle check.
    let liveCats: number[] | null;
    try {
      liveCats = await this.ordClient.getCatsAtOutput(dto.catTxid, dto.catVout);
    } catch (err) {
      this.logger.warn(`ord /output lookup failed for ${dto.catTxid}:${dto.catVout}: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException({
        code: 'ord-lookup-failed',
        detail: 'On-chain cats-bundle check could not complete. Try again in a moment.',
      });
    }
    if (liveCats === null || liveCats.length === 0) {
      throw new BadRequestException({
        code: 'cat-not-found',
        detail:
          `UTXO ${dto.catTxid}:${dto.catVout} carries no cats on ord (already spent, unknown, ` +
          'or never held a cat).',
      });
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
  async findByOutpoint(network: string, catTxid: string, catVout: number): Promise<BidDto[]> {
    const rows = await this.drizzle.db
      .select()
      .from(bids)
      .where(
        and(
          eq(bids.network, network),
          eq(bids.catTxid, catTxid),
          eq(bids.catVout, catVout),
        ),
      )
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
          eq(bids.network, network),
          eq(bids.catTxid, catTxid),
          eq(bids.catVout, catVout),
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
    if (!Number.isInteger(itemsPerPage) || itemsPerPage < 1 || itemsPerPage > 100) {
      throw new BadRequestException('itemsPerPage must be an integer in [1, 100]');
    }
    if (!Number.isInteger(currentPage) || currentPage < 1) {
      throw new BadRequestException('currentPage must be a positive integer');
    }
    const offset = (currentPage - 1) * itemsPerPage;
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
