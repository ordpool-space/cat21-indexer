import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import * as sharp from 'sharp';
import { CATEGORY_RANGES } from '../shared/categories';
import { CatsService, type SearchFilters } from './cats.service';
import { CatDto, CatNumbersPaginatedResultDto, CatSearchQueryDto, CatSearchResultDto, CatsPaginatedResultDto, ExtendedHealthDto, FeeRateSampleDto, HealthDto, StatusDto } from './dto/cat.dto';

// Used for cat IMAGES (SVG/WebP) — the rendered art is truly
// immutable, so a year-long edge cache is fine. Also used for cat
// detail responses whose category is fully-minted (closed) — at
// that point rarity is frozen and the whole row stops changing.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=31536000, immutable';

// Used for cat DETAIL JSON responses whose category is still open.
// The rarity fields (rarityRank/rarityBits/rarityCategoryTotal) shift
// each time a new cat mints into the same category. Short edge cache
// absorbs traffic bursts; rarity updates propagate within minutes.
const CAT_DETAIL_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

/**
 * Pick the right Cache-Control for a cat detail response. Cats whose
 * category is closed AND whose rarity has been computed are fully
 * frozen — immutable. Everything else gets the short TTL so rarity
 * updates can propagate.
 */
function cacheControlFor(cat: CatDto): string {
  const range = CATEGORY_RANGES[cat.category];
  const closed =
    cat.rarityRank !== null &&
    cat.rarityCategoryTotal !== null &&
    range !== undefined &&
    cat.rarityCategoryTotal >= range[2];
  return closed ? IMMUTABLE_CACHE_CONTROL : CAT_DETAIL_CACHE_CONTROL;
}

@ApiTags('api')
@Controller('api')
export class CatsController {
  constructor(private readonly catsService: CatsService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check', description: 'Lean liveness probe — confirms the Node process is alive. Used by Koyeb container health checks; does NOT query the database. For truthful service health (DB reachability, sync freshness), use /api/extendedHealth.' })
  @ApiOkResponse({ type: HealthDto })
  getHealth(): HealthDto {
    return this.catsService.getHealth();
  }

  @Get('extendedHealth')
  @ApiOperation({ summary: 'Extended health check', description: 'Truthful service health: runs a live SELECT 1 against the database and reports sync freshness. Returns 200 when the DB is reachable (even if sync is stalled — status is "degraded"), or 503 when the DB ping fails ("down"). Intended for external monitors and humans, not for container liveness probes.' })
  @ApiOkResponse({ type: ExtendedHealthDto, description: 'DB reachable. status is "ok" when sync is fresh or "degraded" when stalled.' })
  @ApiServiceUnavailableResponse({ type: ExtendedHealthDto, description: 'DB unreachable. The response body is an ExtendedHealthDto with status: "down" and database.error set.' })
  async getExtendedHealth(@Res({ passthrough: true }) reply: FastifyReply): Promise<ExtendedHealthDto> {
    reply.header('Cache-Control', 'no-store');
    const health = await this.catsService.getExtendedHealth();
    if (health.status === 'down') {
      throw new ServiceUnavailableException(health);
    }
    return health;
  }

  @Get('status')
  @ApiOperation({ summary: 'Sync status', description: 'Returns the total number of indexed cats and the last synced cat number.' })
  @ApiOkResponse({ type: StatusDto })
  async getStatus(): Promise<StatusDto> {
    return this.catsService.getStatus();
  }

  @Get('cat/:catNumber')
  @ApiOperation({ summary: 'Get cat by number', description: 'Returns a single CAT-21 cat with all traits by its cat number (0-based).' })
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)', example: 0 })
  @ApiOkResponse({ type: CatDto, description: 'The cat with all computed traits' })
  @ApiNotFoundResponse({ description: 'No cat found with this number' })
  async getCatByNumber(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CatDto> {
    const cat = await this.catsService.getCatByNumber(catNumber);
    if (!cat) {
      reply.header('Cache-Control', 'no-store');
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }
    reply.header('Cache-Control', cacheControlFor(cat));
    return cat;
  }

  @Get('tx/:txHash')
  @ApiOperation({ summary: 'Get cat by transaction hash', description: 'Returns a single CAT-21 cat by the mint transaction hash (64-char hex).' })
  @ApiParam({ name: 'txHash', description: 'Transaction hash (64-char hex)', example: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892' })
  @ApiOkResponse({ type: CatDto, description: 'The cat with all computed traits' })
  @ApiNotFoundResponse({ description: 'No cat found with this transaction hash' })
  async getCatByTxHash(
    @Param('txHash') txHash: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CatDto> {
    if (!/^[a-f0-9]{64}$/.test(txHash)) {
      reply.header('Cache-Control', 'no-store');
      throw new NotFoundException(`Invalid tx hash`);
    }
    const cat = await this.catsService.getCatByTxHash(txHash);
    if (!cat) {
      reply.header('Cache-Control', 'no-store');
      throw new NotFoundException(`Cat with tx ${txHash} not found`);
    }
    reply.header('Cache-Control', cacheControlFor(cat));
    return cat;
  }

  @Get('cat/:catNumber/image.svg')
  @ApiOperation({ summary: 'Get cat SVG image', description: 'Returns the cat as an SVG image. The image is deterministically generated from the transaction and block hash.' })
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)', example: 0 })
  @ApiProduces('image/svg+xml')
  @ApiOkResponse({ description: 'SVG image of the cat' })
  @ApiNotFoundResponse({ description: 'No cat found with this number' })
  async getCatSvg(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res() reply: FastifyReply,
  ) {
    const svg = await this.catsService.getCatSvg(catNumber);
    if (!svg) {
      reply.header('Cache-Control', 'no-store');
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }

    return reply
      .header('Cache-Control', IMMUTABLE_CACHE_CONTROL)
      .header('Content-Type', 'image/svg+xml')
      .header('Content-Disposition', `inline; filename="cat21-${catNumber}.svg"`)
      .send(svg);
  }

  @Get('cat/:catNumber/image.webp')
  @ApiOperation({ summary: 'Get cat WebP image', description: 'Returns the cat as a lossless WebP image (440x440). Optimized for gallery thumbnails.' })
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)', example: 0 })
  @ApiProduces('image/webp')
  @ApiOkResponse({ description: 'WebP image of the cat' })
  @ApiNotFoundResponse({ description: 'No cat found with this number' })
  async getCatWebp(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res() reply: FastifyReply,
  ) {
    const svg = await this.catsService.getCatSvg(catNumber);
    if (!svg) {
      reply.header('Cache-Control', 'no-store');
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }

    try {
      const webp = await sharp(Buffer.from(svg))
        .resize(440, 440)
        .webp({ lossless: true })
        .toBuffer();

      return reply
        .header('Cache-Control', IMMUTABLE_CACHE_CONTROL)
        .header('Content-Type', 'image/webp')
        .header('Content-Disposition', `inline; filename="cat21-${catNumber}.webp"`)
        .send(webp);
    } catch {
      reply.header('Cache-Control', 'no-store');
      throw new InternalServerErrorException(`Failed to render image for cat #${catNumber}`);
    }
  }

  @Get('cat/:catNumber/social.png')
  @ApiOperation({
    summary: 'Get cat social-share card',
    description:
      'Returns a 1200x630 PNG card sized for Open Graph / Twitter previews. The cat art is composited onto a full-bleed field of its own background colour, so a shared /cat/:catNumber link shows the specific cat instead of the generic site preview.',
  })
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)', example: 0 })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: '1200x630 PNG social-share card' })
  @ApiNotFoundResponse({ description: 'No cat found with this number' })
  async getCatSocialCard(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res() reply: FastifyReply,
  ) {
    const cat = await this.catsService.getCatByNumber(catNumber);
    const svg = cat ? await this.catsService.getCatSvg(catNumber) : null;
    if (!cat || !svg) {
      reply.header('Cache-Control', 'no-store');
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }

    // og:image spec target — the 1.91:1 card platforms render at large size.
    const CARD_WIDTH = 1200;
    const CARD_HEIGHT = 630;
    // Cat art sized to sit inside the 630 height with breathing room.
    const CAT_SIZE = 560;
    // Full-bleed background = the cat's own background colour, so the square
    // art (which already carries that colour) melts into the card with no
    // visible seam. Genesis-orange fallback if a cat has no colour recorded.
    const background = cat.backgroundColors?.[0] ?? '#ff9900';

    try {
      const catPng = await sharp(Buffer.from(svg))
        .resize(CAT_SIZE, CAT_SIZE)
        .png()
        .toBuffer();

      const card = await sharp({
        create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background },
      })
        .composite([{ input: catPng, gravity: 'center' }])
        .png()
        .toBuffer();

      return reply
        .header('Cache-Control', IMMUTABLE_CACHE_CONTROL)
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', `inline; filename="cat21-${catNumber}-social.png"`)
        .send(card);
    } catch {
      reply.header('Cache-Control', 'no-store');
      throw new InternalServerErrorException(`Failed to render social card for cat #${catNumber}`);
    }
  }

  @Get('cats/:itemsPerPage/:currentPage')
  @ApiOperation({ summary: 'Get paginated cat list', description: 'Returns a paginated list of cats with all traits, sorted by newest first. Max 100 items per page. Use /api/cats/numbers/ for a lightweight alternative.' })
  @ApiParam({ name: 'itemsPerPage', description: 'Number of cats per page (max 100)', example: 48 })
  @ApiParam({ name: 'currentPage', description: 'Page number (1-based)', example: 1 })
  @ApiOkResponse({ type: CatsPaginatedResultDto, description: 'Paginated list of cats with total count' })
  @ApiBadRequestResponse({ description: 'itemsPerPage or currentPage is not a valid integer' })
  async getCats(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<CatsPaginatedResultDto> {
    return this.catsService.getCats(
      Math.max(1, Math.min(itemsPerPage, 100)),
      Math.max(1, currentPage),
    );
  }

  @Get('cats/numbers/:itemsPerPage/:currentPage')
  @ApiOperation({ summary: 'Get paginated cat numbers', description: 'Returns only cat numbers (no traits). Default sort is newest-first (catNumber DESC); pass ?sort=rarity to order by global rarityBits DESC (rarest across the whole collection — the Genesis Cat first). Max 100 items per page.' })
  @ApiParam({ name: 'itemsPerPage', description: 'Number of cats per page (max 100)', example: 48 })
  @ApiParam({ name: 'currentPage', description: 'Page number (1-based)', example: 1 })
  @ApiQuery({ name: 'sort', required: false, description: 'Sort order: "newest" (default) or "rarity".', enum: ['newest', 'rarity'] })
  @ApiOkResponse({ type: CatNumbersPaginatedResultDto, description: 'Paginated list of cat numbers with total count' })
  @ApiBadRequestResponse({ description: 'itemsPerPage or currentPage is not a valid integer' })
  async getCatNumbers(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
    @Query('sort') sort?: string,
  ): Promise<CatNumbersPaginatedResultDto> {
    return this.catsService.getCatNumbers(
      Math.max(1, Math.min(itemsPerPage, 100)),
      Math.max(1, currentPage),
      sort === 'rarity' ? 'rarity' : 'newest',
    );
  }

  // Declared before `cats/search/:itemsPerPage/:currentPage` so the static
  // path wins over the parametric one.
  //
  // Rate-limited because each call costs two DB queries (COUNT + OFFSET)
  // and is `Cache-Control: no-store`, so a flood can't be absorbed by the
  // edge cache. 30/min/IP matches realistic human dice-roll pacing with
  // room to spare; identifies abusers cleanly.
  @Get('cats/search/random')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Pick one random cat matching the supplied trait filters',
    description:
      'Returns a single random cat number from the set that matches the same ' +
      'filter parameters as /cats/search. With no filters it picks a random ' +
      'cat from the entire collection. Returns 404 if no cat matches. ' +
      'Rate-limited to 30 requests per minute per IP.',
  })
  @ApiOkResponse({
    description: 'A single random matching cat number',
    schema: { type: 'object', properties: { catNumber: { type: 'number', example: 42 } } },
  })
  @ApiNotFoundResponse({ description: 'No cat matches the supplied filters' })
  @ApiBadRequestResponse({ description: 'A filter value is not in the allowed set or exceeds the per-filter length cap' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded — wait a minute and try again' })
  async randomCat(
    @Query() query: CatSearchQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ catNumber: number }> {
    reply.header('Cache-Control', 'no-store');
    const catNumber = await this.catsService.randomCatNumber(toSearchFilters(query));
    if (catNumber === null) {
      throw new NotFoundException('No cat matches the supplied filters');
    }
    return { catNumber };
  }

  @Get('cats/search/:itemsPerPage/:currentPage')
  @ApiOperation({
    summary: 'Search cats by traits',
    description:
      'Returns paginated cat numbers matching the supplied trait filters. ' +
      'Each filter accepts a comma-separated list of values (OR within a filter). ' +
      'Multiple filters are AND-combined. An empty filter (no query params) ' +
      'returns the full result set, equivalent to /cats/numbers/.',
  })
  @ApiParam({ name: 'itemsPerPage', description: 'Number of cats per page (max 100)', example: 48 })
  @ApiParam({ name: 'currentPage', description: 'Page number (1-based)', example: 1 })
  @ApiOkResponse({ type: CatSearchResultDto, description: 'Paginated list of matching cat numbers, total count, and per-dimension facet counts for chip rendering' })
  @ApiBadRequestResponse({ description: 'A filter value is not in the allowed set, exceeds the per-filter length cap, or itemsPerPage/currentPage is not a valid integer' })
  async searchCats(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
    @Query() query: CatSearchQueryDto,
  ): Promise<CatSearchResultDto> {
    return this.catsService.searchCatNumbers(
      toSearchFilters(query),
      Math.max(1, Math.min(itemsPerPage, 100)),
      Math.max(1, currentPage),
      query.sort === 'rarity' ? 'rarity' : 'newest',
    );
  }

  @Get('cats/debug/samples-by-feerate')
  @ApiOperation({
    summary: 'Sample cats by fee rate (debug)',
    description:
      'For each fee rate in the `rates` query parameter, returns the cat ' +
      'closest to that rate within ±0.5 sat/vB. Used by the frontend color ' +
      'debug page to anchor each fee-rate row to a real minted cat.',
  })
  @ApiQuery({ name: 'rates', description: 'Comma-separated list of fee rates (sat/vB), max 200 entries', example: '1,2,5,10,69,75,420,600' })
  @ApiOkResponse({ type: FeeRateSampleDto, isArray: true })
  @ApiBadRequestResponse({ description: 'rates query is missing, malformed, or has more than 200 entries' })
  async sampleCatsByFeeRate(@Query('rates') rates?: string): Promise<FeeRateSampleDto[]> {
    if (!rates) return [];
    const parsed = rates
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 200)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= 0);
    return this.catsService.findSamplesByFeeRate(parsed);
  }
}

function toSearchFilters(q: CatSearchQueryDto): SearchFilters {
  return {
    eyes:       splitCsv(q.eyes),
    pose:       splitCsv(q.pose),
    expression: splitCsv(q.expression),
    pattern:    splitCsv(q.pattern),
    background: splitCsv(q.background),
    crown:      splitCsv(q.crown),
    glasses:    splitCsv(q.glasses),
    category:   splitCsv(q.category),
    gender:     splitCsv(q.gender),
    color:      splitCsv(q.color),
    genesis:    splitCsv(q.genesis),
    rarity:     splitCsv(q.rarity),
  };
}

/**
 * `"a,b, c"` → `['a','b','c']`; `""` / undefined → undefined.
 * Capped at 32 distinct values per filter — the largest legit trait row
 * (color, 7 chips) fits with room to spare; anything bigger is abuse
 * trying to balloon the SQL `IN (…)` clause.
 */
function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 32);
  return parts.length > 0 ? parts : undefined;
}
