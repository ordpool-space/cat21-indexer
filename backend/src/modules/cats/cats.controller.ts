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
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import * as sharp from 'sharp';
import { CatsService, type SearchFilters } from './cats.service';
import { CatDto, CatNumbersPaginatedResultDto, CatsPaginatedResultDto, ExtendedHealthDto, HealthDto, StatusDto } from './dto/cat.dto';

// Browser: 1 day (immutable), Cloudflare edge: 1 year (purgeable)
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=31536000, immutable';

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
    reply.header('Cache-Control', CACHE_CONTROL);
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
    reply.header('Cache-Control', CACHE_CONTROL);
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
      .header('Cache-Control', CACHE_CONTROL)
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
        .header('Cache-Control', CACHE_CONTROL)
        .header('Content-Type', 'image/webp')
        .header('Content-Disposition', `inline; filename="cat21-${catNumber}.webp"`)
        .send(webp);
    } catch {
      reply.header('Cache-Control', 'no-store');
      throw new InternalServerErrorException(`Failed to render image for cat #${catNumber}`);
    }
  }

  @Get('cats/:itemsPerPage/:currentPage')
  @ApiOperation({ summary: 'Get paginated cat list', description: 'Returns a paginated list of cats with all traits, sorted by newest first. Max 100 items per page. Use /api/cats/numbers/ for a lightweight alternative.' })
  @ApiParam({ name: 'itemsPerPage', description: 'Number of cats per page (max 100)', example: 48 })
  @ApiParam({ name: 'currentPage', description: 'Page number (1-based)', example: 1 })
  @ApiOkResponse({ type: CatsPaginatedResultDto, description: 'Paginated list of cats with total count' })
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
  @ApiOperation({ summary: 'Get paginated cat numbers', description: 'Returns only cat numbers (no traits), sorted by newest first. Max 100 items per page. Ideal for gallery views where only thumbnails are needed.' })
  @ApiParam({ name: 'itemsPerPage', description: 'Number of cats per page (max 100)', example: 48 })
  @ApiParam({ name: 'currentPage', description: 'Page number (1-based)', example: 1 })
  @ApiOkResponse({ type: CatNumbersPaginatedResultDto, description: 'Paginated list of cat numbers with total count' })
  async getCatNumbers(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
  ): Promise<CatNumbersPaginatedResultDto> {
    return this.catsService.getCatNumbers(
      Math.max(1, Math.min(itemsPerPage, 100)),
      Math.max(1, currentPage),
    );
  }

  // NOTE: declared BEFORE `cats/search/:itemsPerPage/:currentPage` so the
  // static path wins. Fastify usually prefers static over parametric
  // regardless of declaration order, but ordering it first is the
  // defensive move and removes one thing to think about.
  @Get('cats/search/random')
  @ApiOperation({
    summary: 'Pick one random cat matching the supplied trait filters',
    description:
      'Returns a single random cat number from the set that matches the same ' +
      'filter parameters as /cats/search. Accepts the same query parameters ' +
      '(eyes, pose, expression, pattern, background, crown, glasses, category, ' +
      'gender, color). With no filters it picks a random cat from the entire ' +
      'collection. Returns 404 if no cat matches the filters.',
  })
  @ApiQuery({ name: 'eyes', required: false, example: 'Red,Blue' })
  @ApiQuery({ name: 'pose', required: false, example: 'Sleeping' })
  @ApiQuery({ name: 'expression', required: false, example: 'Smile' })
  @ApiQuery({ name: 'pattern', required: false, example: 'Striped' })
  @ApiQuery({ name: 'background', required: false, example: 'Cyberpunk' })
  @ApiQuery({ name: 'crown', required: false, example: 'Diamond' })
  @ApiQuery({ name: 'glasses', required: false, example: 'Cool' })
  @ApiQuery({ name: 'category', required: false, example: 'sub1k' })
  @ApiQuery({ name: 'gender', required: false, example: 'female' })
  @ApiQuery({ name: 'color', required: false, example: 'red' })
  @ApiOkResponse({
    description: 'A single random matching cat number',
    schema: { type: 'object', properties: { catNumber: { type: 'number', example: 42 } } },
  })
  @ApiNotFoundResponse({ description: 'No cat matches the supplied filters' })
  async randomCat(
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('eyes') eyes?: string,
    @Query('pose') pose?: string,
    @Query('expression') expression?: string,
    @Query('pattern') pattern?: string,
    @Query('background') background?: string,
    @Query('crown') crown?: string,
    @Query('glasses') glasses?: string,
    @Query('category') category?: string,
    @Query('gender') gender?: string,
    @Query('color') color?: string,
  ): Promise<{ catNumber: number }> {
    const filters: SearchFilters = {
      eyes: splitCsv(eyes),
      pose: splitCsv(pose),
      expression: splitCsv(expression),
      pattern: splitCsv(pattern),
      background: splitCsv(background),
      crown: splitCsv(crown),
      glasses: splitCsv(glasses),
      category: splitCsv(category),
      gender: splitCsv(gender),
      color: splitCsv(color),
    };
    // Each call should pick fresh — never cache.
    reply.header('Cache-Control', 'no-store');
    const catNumber = await this.catsService.randomCatNumber(filters);
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
  @ApiQuery({ name: 'eyes', required: false, description: 'Laser eyes: Orange, Red, Green, Blue, None', example: 'Red,Blue' })
  @ApiQuery({ name: 'pose', required: false, description: 'Pose: Standing, Sleeping, Pouncing, Stalking', example: 'Sleeping' })
  @ApiQuery({ name: 'expression', required: false, description: 'Expression: Smile, Grumpy, Pouting, Shy', example: 'Smile' })
  @ApiQuery({ name: 'pattern', required: false, description: 'Coat pattern: Solid, Striped, Eyepatch, Half/Half', example: 'Striped' })
  @ApiQuery({ name: 'background', required: false, description: 'Background: Block9, Cyberpunk, Whitepaper, Orange', example: 'Cyberpunk' })
  @ApiQuery({ name: 'crown', required: false, description: 'Crown: Gold, Diamond, None', example: 'Diamond' })
  @ApiQuery({ name: 'glasses', required: false, description: 'Glasses: Black, Cool, 3D, Nouns, None', example: 'Cool' })
  @ApiQuery({ name: 'category', required: false, description: 'Rarity category: genesis, sub1k, sub10k, sub50k, sub100k, sub250k, sub500k, sub1M. Each cat carries exactly one category band — its smallest applicable (cat 500 = sub1k, cat 5000 = sub10k). Selecting multiple categories OR-combines bands.', example: 'sub1k' })
  @ApiQuery({ name: 'gender', required: false, description: 'Gender: male, female', example: 'female' })
  @ApiQuery({ name: 'color', required: false, description: 'Dominant body color bucket: red, orange, yellow, green, blue, purple, pink. Genesis cats have no body hue and never match.', example: 'red' })
  @ApiOkResponse({ type: CatNumbersPaginatedResultDto, description: 'Paginated list of matching cat numbers with total count' })
  async searchCats(
    @Param('itemsPerPage', ParseIntPipe) itemsPerPage: number,
    @Param('currentPage', ParseIntPipe) currentPage: number,
    @Query('eyes') eyes?: string,
    @Query('pose') pose?: string,
    @Query('expression') expression?: string,
    @Query('pattern') pattern?: string,
    @Query('background') background?: string,
    @Query('crown') crown?: string,
    @Query('glasses') glasses?: string,
    @Query('category') category?: string,
    @Query('gender') gender?: string,
    @Query('color') color?: string,
  ): Promise<CatNumbersPaginatedResultDto> {
    const filters: SearchFilters = {
      eyes: splitCsv(eyes),
      pose: splitCsv(pose),
      expression: splitCsv(expression),
      pattern: splitCsv(pattern),
      background: splitCsv(background),
      crown: splitCsv(crown),
      glasses: splitCsv(glasses),
      category: splitCsv(category),
      gender: splitCsv(gender),
      color: splitCsv(color),
    };
    return this.catsService.searchCatNumbers(
      filters,
      Math.max(1, Math.min(itemsPerPage, 100)),
      Math.max(1, currentPage),
    );
  }

}

/** `"a,b, c"` → `['a','b','c']`; `""` / undefined → undefined. */
function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}
