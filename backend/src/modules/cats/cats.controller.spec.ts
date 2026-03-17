import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';
import { CatDto } from './dto/cat.dto';

const GENESIS_TX = '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892';

const mockCat: CatDto = {
  id: 'uuid-1',
  catNumber: 0,
  txHash: GENESIS_TX,
  blockHash: '000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7',
  blockHeight: 824205,
  mintedAt: '2024-01-03T21:04:46.000Z',
  mintedBy: 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh',
  fee: 40834,
  weight: 705,
  feeRate: 231.67,
  sat: 596964966600565,
  value: 546,
  category: 'sub1k',
  genesis: true,
  catColors: ['#000000'],
  male: true,
  female: false,
  designIndex: 0,
  designPose: 'standing',
  designExpression: 'smile',
  designPattern: 'solid',
  designFacing: 'left',
  laserEyes: null,
  background: null,
  backgroundColors: null,
  crown: null,
  glasses: null,
  glassesColors: null,
};

function createMockReply() {
  const reply = {
    header: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return reply as any;
}

describe('CatsController', () => {
  let controller: CatsController;
  let service: Partial<CatsService>;

  beforeEach(() => {
    service = {
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      getCatByNumber: jest.fn(),
      getCatByTxHash: jest.fn(),
      getCatSvg: jest.fn(),
      getCats: jest.fn(),
    };
    controller = new CatsController(service as CatsService);
  });

  describe('getHealth', () => {
    it('should return health info', () => {
      const health = { status: 'ok', timestamp: '2026-03-17T00:00:00.000Z', uptimeSec: 42, version: '0.1.0' };
      (service.getHealth as jest.Mock).mockReturnValue(health);

      expect(controller.getHealth()).toEqual(health);
    });
  });

  describe('getStatus', () => {
    it('should return status from service', async () => {
      const status = { totalCats: 63732, lastSyncedCatNumber: 63731 };
      (service.getStatus as jest.Mock).mockResolvedValue(status);

      expect(await controller.getStatus()).toEqual(status);
    });
  });

  describe('getCatByNumber', () => {
    it('should return a cat and set immutable cache header', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue(mockCat);
      const reply = createMockReply();

      const result = await controller.getCatByNumber(0, reply);
      expect(result).toEqual(mockCat);
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      );
    });

    it('should throw NotFoundException for unknown cat', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatByNumber(999999, reply)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCatByTxHash', () => {
    it('should return a cat for valid 64-char hex hash', async () => {
      (service.getCatByTxHash as jest.Mock).mockResolvedValue(mockCat);
      const reply = createMockReply();

      const result = await controller.getCatByTxHash(GENESIS_TX, reply);
      expect(result).toEqual(mockCat);
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      );
    });

    it('should throw NotFoundException for unknown tx hash', async () => {
      (service.getCatByTxHash as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatByTxHash(GENESIS_TX, reply)).rejects.toThrow(NotFoundException);
    });

    it('should reject invalid tx hash (too short)', async () => {
      const reply = createMockReply();
      await expect(controller.getCatByTxHash('abc123', reply)).rejects.toThrow(NotFoundException);
      expect(service.getCatByTxHash).not.toHaveBeenCalled();
    });

    it('should reject invalid tx hash (uppercase)', async () => {
      const reply = createMockReply();
      await expect(
        controller.getCatByTxHash(GENESIS_TX.toUpperCase(), reply),
      ).rejects.toThrow(NotFoundException);
      expect(service.getCatByTxHash).not.toHaveBeenCalled();
    });

    it('should reject invalid tx hash (non-hex characters)', async () => {
      const reply = createMockReply();
      const badHash = 'z'.repeat(64);
      await expect(controller.getCatByTxHash(badHash, reply)).rejects.toThrow(NotFoundException);
      expect(service.getCatByTxHash).not.toHaveBeenCalled();
    });
  });

  describe('getCats', () => {
    const emptyPage = { cats: [], total: 0, currentPage: 1, itemsPerPage: 12 };

    it('should cap itemsPerPage at 100', async () => {
      (service.getCats as jest.Mock).mockResolvedValue(emptyPage);
      await controller.getCats(500, 1);
      expect(service.getCats).toHaveBeenCalledWith(100, 1);
    });

    it('should clamp itemsPerPage to min 1', async () => {
      (service.getCats as jest.Mock).mockResolvedValue(emptyPage);
      await controller.getCats(-5, 1);
      expect(service.getCats).toHaveBeenCalledWith(1, 1);
    });

    it('should clamp currentPage to min 1', async () => {
      (service.getCats as jest.Mock).mockResolvedValue(emptyPage);
      await controller.getCats(12, -3);
      expect(service.getCats).toHaveBeenCalledWith(12, 1);
    });

    it('should clamp zero itemsPerPage to 1', async () => {
      (service.getCats as jest.Mock).mockResolvedValue(emptyPage);
      await controller.getCats(0, 1);
      expect(service.getCats).toHaveBeenCalledWith(1, 1);
    });

    it('should pass through valid values unchanged', async () => {
      (service.getCats as jest.Mock).mockResolvedValue(emptyPage);
      await controller.getCats(48, 5);
      expect(service.getCats).toHaveBeenCalledWith(48, 5);
    });
  });

  describe('getCatSvg', () => {
    it('should throw NotFoundException for unknown cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatSvg(999999, reply)).rejects.toThrow(NotFoundException);
    });

    it('should send SVG with correct headers', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue('<svg>test</svg>');
      const reply = createMockReply();

      await controller.getCatSvg(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
      expect(reply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="cat21-0.svg"',
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      );
      expect(reply.send).toHaveBeenCalledWith('<svg>test</svg>');
    });
  });

  describe('getCatPng', () => {
    it('should throw NotFoundException for unknown cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatPng(999999, reply)).rejects.toThrow(NotFoundException);
    });

    it('should send PNG with correct headers for valid cat', async () => {
      // Minimal valid SVG
      (service.getCatSvg as jest.Mock).mockResolvedValue(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="red"/></svg>',
      );
      const reply = createMockReply();

      await controller.getCatPng(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(reply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="cat21-0.png"',
      );
      expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should throw InternalServerErrorException for invalid SVG', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue('not-valid-svg');
      const reply = createMockReply();

      await expect(controller.getCatPng(0, reply)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getCatGif', () => {
    it('should throw NotFoundException for unknown cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatGif(999999, reply)).rejects.toThrow(NotFoundException);
    });

    it('should send GIF with correct headers for valid cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="red"/></svg>',
      );
      const reply = createMockReply();

      await controller.getCatGif(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/gif');
      expect(reply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="cat21-0.gif"',
      );
      expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should throw InternalServerErrorException for invalid SVG', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue('not-valid-svg');
      const reply = createMockReply();

      await expect(controller.getCatGif(0, reply)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
