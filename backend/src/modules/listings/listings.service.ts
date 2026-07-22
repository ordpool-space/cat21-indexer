import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { verifyListingSignature } from 'ordpool-sdk/core';

import {
  BackendNetworkString,
  catsArraysEqual,
  readBackendNetworkFromEnv,
  toSdkNetwork,
} from '../shared/backend-network';
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
  private readonly backendNetwork: BackendNetworkString = readBackendNetworkFromEnv();

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly ordClient: OrdClientService,
  ) {
    this.logger.log(`ListingsService: BACKEND_NETWORK = ${this.backendNetwork}`);
  }

  /**
   * Create (or overwrite) the active listing for a cat UTXO.
   *
   * Check order — CHEAP checks before expensive ones so a spammer
   * can't burn CPU by flooding malformed payloads:
   *
   *   1. Network match (constant equality, sub-µs).
   *   2. Anti-replay window (arithmetic).
   *   3. Headline-membership (`catNumber` ∈ `cats`).
   *   4. BIP-322 signature verify (schnorr, ~ms).
   *   5. On-chain cross-check via ord — TWO lookups:
   *        a. `/output/<outpoint>` returns the live `cats` array.
   *           If it drifts from what the seller signed, reject.
   *        b. `/cat/N` + `/inscription/id` for the headline cat's
   *           current owning address (proves the seller controls
   *           the UTXO).
   *   6. Upsert.
   *
   * Any step that fails throws `BadRequestException` with a code the
   * frontend surfaces to the seller. No partial writes.
   */
  async create(dto: CreateListingDto): Promise<ListingDto> {
    // (1) Network — cheap fail-fast. Also blocks a seller who typo'd
    //     `network=testnet3` from submitting to the mainnet backend.
    if (dto.network !== this.backendNetwork) {
      throw new BadRequestException({
        code: 'network-mismatch',
        detail: `Listing signed for network=${dto.network}; this backend serves ${this.backendNetwork}.`,
      });
    }

    // (2) Anti-replay window — arithmetic on a couple of ints.
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

    // (3) Headline membership — the SDK enforces this pre-sign, but
    //     defence in depth: a client bypassing the SDK could hand us
    //     a headline outside the bundle to hide a lower-numbered cat.
    if (!dto.cats.includes(dto.catNumber)) {
      throw new BadRequestException({
        code: 'headline-not-in-bundle',
        detail: `catNumber ${dto.catNumber} is not a member of cats [${dto.cats.join(',')}]`,
      });
    }

    // (4) BIP-322 signature verify — schnorr, ~ms. The SDK's verify
    //     rebuilds the canonical message from the fields; no separate
    //     builder call here.
    const verifyResult = verifyListingSignature({
      fields: {
        catNumber: dto.catNumber,
        cats: dto.cats,
        network: toSdkNetwork(dto.network),
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

    // (5a) On-chain: fetch the live cats bundle on the UTXO.
    let liveCats: number[] | null;
    try {
      liveCats = await this.ordClient.getCatsAtOutput(dto.catTxid, dto.catVout);
    } catch (err) {
      this.logger.warn(
        `ord /output lookup failed for ${dto.catTxid}:${dto.catVout}: ${err instanceof Error ? err.message : err}`,
      );
      throw new BadRequestException({
        code: 'ord-lookup-failed',
        detail: 'On-chain cats-bundle check could not complete. Try again in a moment.',
      });
    }
    if (liveCats === null || liveCats.length === 0) {
      throw new BadRequestException({
        code: 'cat-not-found',
        detail:
          `UTXO ${dto.catTxid}:${dto.catVout} carries no cats on ord (already spent, ` +
          `unknown, or never held a cat). If the cat just moved, re-sign against the ` +
          `new outpoint.`,
      });
    }
    if (!catsArraysEqual(liveCats, dto.cats)) {
      throw new BadRequestException({
        code: 'cats-bundle-drift',
        detail:
          `You signed for cats=[${dto.cats.join(',')}] but the UTXO now carries ` +
          `[${liveCats.join(',')}]. Re-sign against the current bundle.`,
      });
    }

    // (5b) On-chain: cross-check that the seller actually controls
    //      the UTXO. The headline cat's current owner is the whole
    //      UTXO's owner (all cats on one UTXO share one spending
    //      key).
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
    // Address equality with lowercase normalization — bech32 addresses
    // are canonical-lowercase, but any HRP-case drift between ord and
    // the DTO would false-negative the equality check.
    if (current.ordinalsAddress.toLowerCase() !== dto.ordinalsAddress.toLowerCase()) {
      throw new BadRequestException({
        code: 'not-current-owner',
        detail: `Signature is valid, but ${dto.ordinalsAddress} is not the current owner of cat #${dto.catNumber}.`,
      });
    }
    if (current.txid !== dto.catTxid.toLowerCase() || current.vout !== dto.catVout) {
      throw new BadRequestException({
        code: 'outpoint-mismatch',
        detail:
          `Cat has moved since you signed. Current outpoint is ${current.txid}:${current.vout}, ` +
          `signature pinned ${dto.catTxid}:${dto.catVout}. Re-sign against the current UTXO.`,
      });
    }

    // (6) Upsert. UTXO uniqueness — a re-listing at a new price
    //     replaces the old row atomically.
    const catsSorted = [...new Set(dto.cats)].sort((a, b) => a - b);
    const row = {
      catNumber: dto.catNumber,
      cats: catsSorted,
      network: dto.network,
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
      .values({
        catNumber: row.catNumber,
        catsOnUtxo: row.cats,
        headlineCatNumber: row.catNumber,
        network: row.network,
        askSats: row.askSats,
        payTo: row.payTo,
        catTxid: row.catTxid,
        catVout: row.catVout,
        ordinalsAddress: row.ordinalsAddress,
        signedAt: row.signedAt,
        signature: row.signature,
      })
      .onDuplicateKeyUpdate({
        set: {
          catNumber: row.catNumber,
          catsOnUtxo: row.cats,
          headlineCatNumber: row.catNumber,
          askSats: row.askSats,
          payTo: row.payTo,
          ordinalsAddress: row.ordinalsAddress,
          signedAt: row.signedAt,
          signature: row.signature,
        },
      });

    // Read back — MySQL/mysql2 doesn't return the inserted row on
    // ON DUPLICATE KEY UPDATE, and we need `id` + `createdAt` for the
    // response. Query by the new uniqueness key (network + outpoint).
    const persisted = await this.findByOutpoint(dto.network, dto.catTxid, dto.catVout);
    if (!persisted) {
      // Would only happen under concurrent-delete with a pruner run —
      // return 400-ish to force the client to retry.
      throw new BadRequestException({
        code: 'persist-race',
        detail: 'Listing was accepted but disappeared before read-back. Retry.',
      });
    }
    return persisted;
  }

  /**
   * Return the active listing for a specific cat. Under v3 the same
   * cat can appear as headline OR as a bundle member — a lookup by
   * cat number resolves the FIRST listing where the cat is on the
   * UTXO. Used by the frontend's per-cat details badge.
   */
  async findByCatNumber(catNumber: number): Promise<ListingDto | null> {
    // Fast path: headline match. Vast majority of the time, a lookup
    // for cat #42 wants the listing where 42 IS the headline. If a
    // seller listed 42 as a bundle-mate of a lower cat, the headline
    // lookup won't find it — the frontend can call findByOutpoint
    // once it has the outpoint from ord.
    const rows = await this.drizzle.db
      .select()
      .from(listings)
      .where(eq(listings.catNumber, catNumber))
      .limit(1);
    if (rows.length === 0) return null;
    return this.rowToDto(rows[0]);
  }

  /**
   * Look up the listing at a specific UTXO (network + outpoint).
   * The v3 uniqueness key. Used post-insert for read-back.
   */
  async findByOutpoint(network: string, catTxid: string, catVout: number): Promise<ListingDto | null> {
    const rows = await this.drizzle.db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.network, network),
          eq(listings.catTxid, catTxid),
          eq(listings.catVout, catVout),
        ),
      )
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
   * Remove a listing by cat number (server-side; no signature
   * required). Used by an eventual seller-side cancel flow. The
   * pruner uses `deleteByIdIfUnchanged` instead to avoid the
   * read-then-delete race that would kill a freshly-upserted row.
   */
  async deleteByCatNumber(catNumber: number): Promise<void> {
    await this.drizzle.db.delete(listings).where(eq(listings.catNumber, catNumber));
  }

  /**
   * Remove a listing by its server-assigned id + expected signedAt.
   * Used exclusively by the pruner: guarantees the row we delete is
   * the one we read (the pruner captured `id` at snapshot time). If
   * a seller re-lists between the pruner's snapshot and the delete,
   * `onDuplicateKeyUpdate` swaps `signedAt`; the delete's WHERE now
   * doesn't match, so the fresh row survives.
   */
  async deleteByIdIfUnchanged(id: string, signedAt: number): Promise<void> {
    await this.drizzle.db
      .delete(listings)
      .where(and(eq(listings.id, id), eq(listings.signedAt, signedAt)));
  }

  /**
   * Row → DTO. `createdAt` becomes an ISO-8601 string (portable
   * timestamp format for JSON clients).
   */
  private rowToDto(row: typeof listings.$inferSelect): ListingDto {
    return {
      id: row.id,
      catNumber: row.catNumber,
      cats: row.catsOnUtxo,
      network: row.network,
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
