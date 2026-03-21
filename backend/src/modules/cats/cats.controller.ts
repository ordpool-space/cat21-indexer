import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import * as sharp from 'sharp';
import { CatsService } from './cats.service';
import { CatDto, CatsPaginatedResultDto, HealthDto, StatusDto } from './dto/cat.dto';

// Browser: 1 day (immutable), Cloudflare edge: 1 year (purgeable)
const CACHE_CONTROL = 'public, max-age=86400, s-maxage=31536000, immutable';

@ApiTags('api')
@Controller('api')
export class CatsController {
  constructor(private readonly catsService: CatsService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check', description: 'Returns service health info including uptime and version.' })
  @ApiOkResponse({ type: HealthDto })
  getHealth(): HealthDto {
    return this.catsService.getHealth();
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
  @ApiOperation({ summary: 'Get paginated cat list', description: 'Returns a paginated list of cats, sorted by newest first. Max 100 items per page.' })
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
}
