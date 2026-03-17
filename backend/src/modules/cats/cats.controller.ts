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

const IMMUTABLE = 'public, max-age=31536000, immutable';

type ImageFormat = 'png' | 'gif';

const IMAGE_CONFIG: Record<ImageFormat, { contentType: string; convert: (s: sharp.Sharp) => sharp.Sharp }> = {
  png: { contentType: 'image/png', convert: (s) => s.png({ compressionLevel: 9, palette: true }) },
  gif: { contentType: 'image/gif', convert: (s) => s.gif() },
};

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
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }
    reply.header('Cache-Control', IMMUTABLE);
    return cat;
  }

  @Get('tx/:txHash')
  @ApiParam({ name: 'txHash', description: 'Transaction hash (64-char hex)' })
  async getCatByTxHash(
    @Param('txHash') txHash: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CatDto> {
    if (!/^[a-f0-9]{64}$/.test(txHash)) {
      throw new NotFoundException(`Invalid tx hash`);
    }
    const cat = await this.catsService.getCatByTxHash(txHash);
    if (!cat) {
      throw new NotFoundException(`Cat with tx ${txHash} not found`);
    }
    reply.header('Cache-Control', IMMUTABLE);
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
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }

    return reply
      .header('Cache-Control', IMMUTABLE)
      .header('Content-Type', 'image/svg+xml')
      .header('Content-Disposition', `inline; filename="cat21-${catNumber}.svg"`)
      .send(svg);
  }

  @Get('cat/:catNumber/image.png')
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)' })
  @ApiProduces('image/png')
  async getCatPng(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res() reply: FastifyReply,
  ) {
    return this.renderImage(catNumber, 'png', reply);
  }

  @Get('cat/:catNumber/image.gif')
  @ApiParam({ name: 'catNumber', description: 'Cat number (0-based)' })
  @ApiProduces('image/gif')
  async getCatGif(
    @Param('catNumber', ParseIntPipe) catNumber: number,
    @Res() reply: FastifyReply,
  ) {
    return this.renderImage(catNumber, 'gif', reply);
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

  private async renderImage(catNumber: number, format: ImageFormat, reply: FastifyReply) {
    const svg = await this.catsService.getCatSvg(catNumber);
    if (!svg) {
      throw new NotFoundException(`Cat #${catNumber} not found`);
    }

    const { contentType, convert } = IMAGE_CONFIG[format];

    try {
      const buffer = await convert(sharp(Buffer.from(svg)).resize(440, 440)).toBuffer();

      return reply
        .header('Cache-Control', IMMUTABLE)
        .header('Content-Type', contentType)
        .header('Content-Disposition', `inline; filename="cat21-${catNumber}.${format}"`)
        .send(buffer);
    } catch {
      throw new InternalServerErrorException(`Failed to render image for cat #${catNumber}`);
    }
  }
}
