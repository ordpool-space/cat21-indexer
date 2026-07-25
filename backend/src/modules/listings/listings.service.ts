import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';

import { catsArraysEqual } from '../shared/array-utils';
import {
  BackendNetworkString,
  readBackendNetworkFromEnv,
} from '../shared/backend-network';
import { DrizzleService } from '../shared/drizzle/drizzle.service';
import { listings } from '../shared/drizzle/schema/listings';
import { OrdClientService } from '../sync/ord-client.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListingDto, PaginatedListingsDto } from './dto/listing.dto';

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
   * Auth: caller must have passed the Cat21SessionGuard, which puts
   * the verified `sellerOrdinalsAddress` on the request and hands it
   * to this service via the second arg. This service asserts the
   * session address matches `dto.ordinalsAddress` as defence in depth.
   *
   * Check order — CHEAP first so spammers can't burn CPU:
   *
   *   1. Network match (constant equality, sub-µs).
   *   2. Session address == DTO ordinals address.
   *   3. Headline-membership (`catNumber` ∈ `cats`).
   *   4. On-chain cross-check via ord — TWO lookups:
   *        a. `/output/<outpoint>` returns the live `cats` array.
   *           If it drifts from what the seller submitted, reject.
   *        b. `/cat/N` + `/inscription/id` for the headline cat's
   *           current owning address (proves the seller controls
   *           the UTXO right now, not just at session-sign time).
   *   5. Upsert.
   *
   * Any step that fails throws `BadRequestException` with a code the
   * frontend surfaces to the seller. No partial writes.
   */
  async create(dto: CreateListingDto, sellerOrdinalsAddress: string): Promise<ListingDto> {
    // (1) Network — cheap fail-fast.
    if (dto.network !== this.backendNetwork) {
      throw new BadRequestException({
        code: 'network-mismatch',
        detail: `Listing targets network=${dto.network}; this backend serves ${this.backendNetwork}.`,
      });
    }

    // (2) Session-address ↔ DTO ordinals-address match. The controller
    //     also checks this via the guard's verified address, but a
    //     defence-in-depth assert here means the service can't be
    //     misused by a future caller that skips the guard check.
    if (dto.ordinalsAddress !== sellerOrdinalsAddress) {
      throw new BadRequestException({
        code: 'session-address-mismatch',
        detail: 'Session token proves control of a different address than dto.ordinalsAddress.',
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

    // (4a) On-chain: fetch the live cats bundle on the UTXO.
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

    // (5) Upsert. UTXO uniqueness — a re-listing at a new price
    //     replaces the old row atomically. Server-assigns `signedAt`
    //     (used by the pruner's id+signedAt race-safe delete) and
    //     stores an empty `signature` — the column is a legacy field
    //     from the pre-session-token per-listing BIP-322 era and no
    //     longer carries authoritative meaning.
    const catsSorted = [...new Set(dto.cats)].sort((a, b) => a - b);
    const insertedSignedAt = Math.floor(Date.now() / 1000);
    const row = {
      catNumber: dto.catNumber,
      cats: catsSorted,
      network: dto.network,
      askSats: dto.askSats,
      payTo: dto.payTo,
      catTxid: dto.catTxid,
      catVout: dto.catVout,
      ordinalsAddress: dto.ordinalsAddress,
      signedAt: insertedSignedAt,
      signature: '',
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
   * Ownership-scoped delete used by the public DELETE route: only
   * deletes the row iff its `ordinalsAddress` matches the caller's
   * session-verified address. Returns `true` if a row was deleted,
   * `false` if no matching row existed (already deleted, wrong
   * address, or wrong cat).
   */
  async deleteByCatNumberIfOwnedBy(catNumber: number, ordinalsAddress: string): Promise<boolean> {
    const [existing] = await this.drizzle.db
      .select({ id: listings.id, ordinalsAddress: listings.ordinalsAddress })
      .from(listings)
      .where(eq(listings.catNumber, catNumber))
      .limit(1);
    if (!existing) return false;
    if (existing.ordinalsAddress !== ordinalsAddress) return false;
    await this.drizzle.db.delete(listings).where(eq(listings.id, existing.id));
    return true;
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
