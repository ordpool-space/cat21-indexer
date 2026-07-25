import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import {
  Cat21SessionAddress,
  Cat21SessionGuard,
} from '../shared/cat21-session.guard';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListingDto, PaginatedListingsDto } from './dto/listing.dto';
import { ListingsService } from './listings.service';

// Per the backend HARD RULE (Cache-Control):
// - Errors → no-store (prevent 404 cache poisoning on a listing that
//   just got pruned).
// - Paginated feed → no header (dynamic, edge bypasses cache).
// - Single listing → short max-age (60s) so a new listing shows up
//   within a minute; a stale one for a moved cat is culled by the
//   pruner within an hour regardless of cache TTL.
const SINGLE_LISTING_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
const NO_STORE = 'no-store';

@ApiTags('listings')
@Controller('api/v1/listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @HttpCode(201)
  // Rate limit: 5 listing publishes / minute / IP. Guards our ord
  // instance against DoS via valid-but-flooded POSTs (each POST costs
  // ~2 ord API calls). Legitimate sellers won't publish more than a
  // handful of listings per minute across their entire cat inventory;
  // an attacker flooding with session-authed junk is capped hard.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(Cat21SessionGuard, ThrottlerGuard)
  @ApiOperation({
    summary: 'Create or overwrite a cat listing',
    description:
      "Publishes a sell intent to the CAT-21 orderbook. Authentication is header-based " +
      "via the Cat21SessionGuard (X-Cat21-Session-Address / -Valid-Until / -Signature). " +
      "The session address must match `dto.ordinalsAddress`. The server cross-checks " +
      "with ord that the address really owns cat #`catNumber` at outpoint `catTxid:catVout` " +
      "RIGHT NOW. Any tamper is rejected with a specific error code. cat_number is unique " +
      "— re-POSTing for a cat OVERWRITES the previous listing (price change flow). " +
      "Rate-limited to 5/min/IP.",
  })
  @ApiTooManyRequestsResponse({ description: 'Exceeded 5 listing publishes per minute per IP.' })
  @ApiCreatedResponse({ type: ListingDto })
  @ApiBadRequestResponse({
    description:
      'Rejection with a code:\n' +
      '- `network-mismatch` — DTO network doesn\'t match this backend\'s deployment\n' +
      '- `session-address-mismatch` — session address ≠ dto.ordinalsAddress\n' +
      '- `headline-not-in-bundle` — catNumber not in cats[]\n' +
      '- `ord-lookup-failed` — upstream ord unreachable\n' +
      '- `cat-not-found` — ord does not know this cat (or it sits at an unspendable output)\n' +
      '- `cats-bundle-drift` — signed cats bundle no longer matches the UTXO\n' +
      '- `not-current-owner` — session address is not the current on-chain owner\n' +
      '- `outpoint-mismatch` — cat has moved; re-submit against the current UTXO',
  })
  async create(
    @Body() dto: CreateListingDto,
    @Cat21SessionAddress() sessionAddress: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ListingDto> {
    try {
      const created = await this.listings.create(dto, sessionAddress);
      reply.header('Cache-Control', NO_STORE);
      return created;
    } catch (err) {
      reply.header('Cache-Control', NO_STORE);
      throw err;
    }
  }

  @Get('cat/:catNumber')
  @ApiOperation({
    summary: 'Get the active listing for a cat',
    description:
      'Returns the active seller-signed listing for cat #catNumber, or 404 if the cat is ' +
      'not currently listed. External clients can re-verify the returned signature offline ' +
      'via ordpool-sdk `verifyListingSignature` — no trust in cat21-indexer required.',
  })
  @ApiParam({
    name: 'catNumber',
    description: 'Cat number (0 = Genesis Cat).',
    example: 42,
    schema: { type: 'integer', minimum: 0 },
  })
  @ApiOkResponse({ type: ListingDto })
  @ApiNotFoundResponse({ description: 'No active listing for this cat.' })
  async findByCatNumber(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ListingDto> {
    const listing = await this.listings.findByCatNumber(catNumber);
    if (!listing) {
      // Per HARD RULE: 404 gets `no-store` to prevent cache poisoning
      // when a listing appears later.
      reply.header('Cache-Control', NO_STORE);
      throw new NotFoundException(`No active listing for cat #${catNumber}`);
    }
    reply.header('Cache-Control', SINGLE_LISTING_CACHE_CONTROL);
    return listing;
  }

  @Get(':itemsPerPage/:currentPage')
  @ApiOperation({
    summary: 'Browse the CAT-21 orderbook',
    description:
      'Paginated feed of all active listings, most-recently-signed first. Bounded at ' +
      '100 items per page. No Cache-Control set — edge bypasses cache (orderbook changes ' +
      'per listing/prune).',
  })
  @ApiParam({
    name: 'itemsPerPage',
    description: 'Page size, 1..100.',
    example: 25,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiParam({
    name: 'currentPage',
    description: 'Page number, 1-indexed.',
    example: 1,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiOkResponse({ type: PaginatedListingsDto })
  async findPaginated(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<PaginatedListingsDto> {
    return this.listings.findPaginated(itemsPerPage, currentPage);
  }

  @Delete('cat/:catNumber')
  @HttpCode(204)
  @UseGuards(Cat21SessionGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Delete a listing (seller unlists)',
    description:
      'Removes the listing for cat #catNumber iff the session token proves control of ' +
      "the listing's `ordinalsAddress`. The pruner uses ListingsService directly and is " +
      "unaffected by this route's auth.",
  })
  @ApiNoContentResponse({ description: 'Deleted (or already absent — a wrong-owner request also 204s without leaking whether the row existed).' })
  async delete(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Cat21SessionAddress() sessionAddress: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    // Ownership-scoped delete: returns true iff a row matching both
    // catNumber AND ordinalsAddress existed. Non-owner or missing
    // row both 204 so we don't leak which listings exist to callers
    // holding a valid session token for the wrong address.
    await this.listings.deleteByCatNumberIfOwnedBy(catNumber, sessionAddress);
    reply.header('Cache-Control', NO_STORE);
  }
}
