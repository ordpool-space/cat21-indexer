import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { count, desc, eq, or, sql } from 'drizzle-orm';
import { buildListingMessage, verifyListingSignature } from 'ordpool-sdk/core';

import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { listings } from '../shared/drizzle/schema/listings';
import { OrdClientService } from '../sync/ord-client.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListingDto, PaginatedListingsDto } from './dto/listing.dto';

/**
 * Anti-replay window. `signedAt` older than this or more than
 * `CLOCK_SKEW_FUTURE_S` in the future gets rejected at the door.
 * 24h back = generous room for a seller who signed and then took a
 * while to submit; 1h forward = only clock-skewed devices should
 * cross that line at all.
 */
const ANTI_REPLAY_MAX_AGE_S = 24 * 60 * 60;
const CLOCK_SKEW_FUTURE_S = 60 * 60;

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
  ) {}

  /**
   * Create (or overwrite) the active listing for a cat. Steps:
   *
   *   1. Verify the BIP-322 signature via ordpool-sdk.
   *   2. Check `signedAt` is within the anti-replay window.
   *   3. Cross-check with ord: the cat's CURRENT ordinals address
   *      MUST equal the DTO's `ordinalsAddress`, AND the cat's
   *      CURRENT outpoint MUST equal `(catTxid, catVout)`. A seller
   *      can't list a cat someone else already moved.
   *   4. Upsert into `listings` — `cat_number` is unique, so re-listing
   *      a cat at a new price replaces the old row.
   *
   * Any step that fails throws `BadRequestException` with a code the
   * frontend surfaces to the seller. No partial writes.
   */
  async create(dto: CreateListingDto): Promise<ListingDto> {
    // (1) BIP-322 signature verify — recomputes the canonical message
    //     from the DTO fields and validates the schnorr sig against
    //     the seller's ordinals P2TR address. Any tampered field
    //     invalidates the signature.
    let message: string;
    try {
      message = buildListingMessage({
        catNumber: dto.catNumber,
        askSats: dto.askSats,
        payTo: dto.payTo as never,             // brand check runs inside verify via toPaymentAddress
        catTxid: dto.catTxid,
        catVout: dto.catVout,
        ordinalsAddress: dto.ordinalsAddress as never,
        signedAt: dto.signedAt,
      });
    } catch (err) {
      // Field-level shape check failed (class-validator already ran, but
      // sdk's builder has stricter rules e.g. lowercase-hex catTxid).
      throw new BadRequestException({
        code: 'invalid-listing-fields',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    // `message` was built but the actual verify call rebuilds it too;
    // that's fine — deterministic + cheap. The double-build keeps the
    // "single canonical message" invariant readable in this code.
    const verifyResult = verifyListingSignature({
      fields: {
        catNumber: dto.catNumber,
        askSats: dto.askSats,
        payTo: dto.payTo as never,
        catTxid: dto.catTxid,
        catVout: dto.catVout,
        ordinalsAddress: dto.ordinalsAddress as never,
        signedAt: dto.signedAt,
      },
      signatureBase64: dto.signature,
    });
    if (!verifyResult.ok) {
      throw new BadRequestException({
        code: `signature-${verifyResult.reason}`,
        detail: verifyResult.detail,
      });
    }

    // (2) Anti-replay window. Anything older than 24h or > 1h in the
    //     future is either a stale submission or a clock-skew attack.
    const nowS = Math.floor(Date.now() / 1000);
    if (dto.signedAt < nowS - ANTI_REPLAY_MAX_AGE_S) {
      throw new BadRequestException({
        code: 'signature-too-old',
        detail: `signedAt is ${nowS - dto.signedAt}s in the past; max ${ANTI_REPLAY_MAX_AGE_S}s`,
      });
    }
    if (dto.signedAt > nowS + CLOCK_SKEW_FUTURE_S) {
      throw new BadRequestException({
        code: 'signature-in-future',
        detail: `signedAt is ${dto.signedAt - nowS}s in the future; max ${CLOCK_SKEW_FUTURE_S}s`,
      });
    }

    // (3) On-chain cross-check via ord. Confirms:
    //       a. The cat exists.
    //       b. The DTO's `ordinalsAddress` really is the current owner
    //          (attacker with a valid sig for a cat they no longer own
    //          gets rejected).
    //       c. The DTO's outpoint matches the CURRENT one (self-anti-
    //          stale — seller can't list against a stale UTXO).
    let current;
    try {
      current = await this.ordClient.getCatCurrentLocation(dto.catNumber);
    } catch (err) {
      this.logger.warn(`ord lookup failed for cat #${dto.catNumber}: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException({
        code: 'ord-lookup-failed',
        detail: 'On-chain owner check could not complete. Try again in a moment.',
      });
    }
    if (!current) {
      throw new BadRequestException({
        code: 'cat-not-found',
        detail: `Cat #${dto.catNumber} not found on ord (or sits at an unspendable output).`,
      });
    }
    if (current.ordinalsAddress !== dto.ordinalsAddress) {
      throw new BadRequestException({
        code: 'not-current-owner',
        detail: `Signature is valid, but ${dto.ordinalsAddress} is not the current owner of cat #${dto.catNumber}.`,
      });
    }
    if (current.txid !== dto.catTxid || current.vout !== dto.catVout) {
      throw new BadRequestException({
        code: 'outpoint-mismatch',
        detail:
          `Cat has moved since you signed. Current outpoint is ${current.txid}:${current.vout}, ` +
          `signature pinned ${dto.catTxid}:${dto.catVout}. Re-sign against the current UTXO.`,
      });
    }

    // (4) Upsert. cat_number is unique — a re-listing at a new price
    //     replaces the old row atomically.
    const row = {
      catNumber: dto.catNumber,
      askSats: dto.askSats,
      payTo: dto.payTo,
      catTxid: dto.catTxid,
      catVout: dto.catVout,
      ordinalsAddress: dto.ordinalsAddress,
      signedAt: dto.signedAt,
      signature: dto.signature,
    };
    await this.drizzle.db
      .insert(listings)
      .values(row)
      .onDuplicateKeyUpdate({
        set: {
          askSats: row.askSats,
          payTo: row.payTo,
          catTxid: row.catTxid,
          catVout: row.catVout,
          ordinalsAddress: row.ordinalsAddress,
          signedAt: row.signedAt,
          signature: row.signature,
        },
      });

    // Read back — MySQL/mysql2 doesn't return the inserted row on
    // ON DUPLICATE KEY UPDATE, and we need `id` + `createdAt` for the
    // response.
    const persisted = await this.findByCatNumber(dto.catNumber);
    if (!persisted) {
      // Would only happen under concurrent-delete with a pruner run —
      // return 500-ish to force the client to retry.
      throw new BadRequestException({
        code: 'persist-race',
        detail: 'Listing was accepted but disappeared before read-back. Retry.',
      });
    }
    return persisted;
  }

  /**
   * Return the active listing for a specific cat, or null if none.
   * "Active" = present in the table — the pruner removes stale ones.
   */
  async findByCatNumber(catNumber: number): Promise<ListingDto | null> {
    const rows = await this.drizzle.db
      .select()
      .from(listings)
      .where(eq(listings.catNumber, catNumber))
      .limit(1);
    if (rows.length === 0) return null;
    return this.rowToDto(rows[0]);
  }

  /**
   * Paginated feed of active listings, most-recently-signed first.
   * Bounded page size to keep the query cheap and prevent scraping
   * pressure — 100 rows/page hard cap.
   */
  async findPaginated(itemsPerPage: number, currentPage: number): Promise<PaginatedListingsDto> {
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
        .from(listings)
        .orderBy(desc(listings.signedAt))
        .limit(itemsPerPage)
        .offset(offset),
      this.drizzle.db.select({ total: count() }).from(listings),
    ]);
    return {
      total,
      currentPage,
      itemsPerPage,
      items: rows.map((r) => this.rowToDto(r)),
    };
  }

  /**
   * Remove a listing (server-side; no signature required). Used by
   * the pruner and by an eventual seller-side cancel flow.
   */
  async deleteByCatNumber(catNumber: number): Promise<void> {
    await this.drizzle.db.delete(listings).where(eq(listings.catNumber, catNumber));
  }

  /**
   * Row → DTO. `createdAt` becomes an ISO-8601 string (portable
   * timestamp format for JSON clients).
   */
  private rowToDto(row: typeof listings.$inferSelect): ListingDto {
    return {
      id: row.id,
      catNumber: row.catNumber,
      askSats: row.askSats,
      payTo: row.payTo,
      catTxid: row.catTxid,
      catVout: row.catVout,
      ordinalsAddress: row.ordinalsAddress,
      signedAt: row.signedAt,
      signature: row.signature,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
