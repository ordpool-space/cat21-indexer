import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
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
  getHealth(): HealthDto {
    return this.catsService.getHealth();
  }

  @Get('status')
  async getStatus(): Promise<StatusDto> {
    return this.catsService.getStatus();
  }

  @Get('cat/:catNumber')
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)' })
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
  @ApiParam({ name: 'txHash', description: 'Transaction hash (64-char hex)' })
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
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)' })
  @ApiProduces('image/svg+xml')
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
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)' })
  @ApiProduces('image/webp')
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
  @ApiParam({ name: 'itemsPerPage', description: 'Number of cats per page (max 100)' })
  @ApiParam({ name: 'currentPage', description: 'Page number (1-based)' })
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
