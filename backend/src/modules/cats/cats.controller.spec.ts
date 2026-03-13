import { NotFoundException } from '@nestjs/common';
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
      getStatus: jest.fn(),
      getCatByNumber: jest.fn(),
      getCatByTxHash: jest.fn(),
      getCatSvg: jest.fn(),
      getCats: jest.fn(),
    };
    controller = new CatsController(service as CatsService);
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
    it('should cap itemsPerPage at 100', async () => {
      (service.getCats as jest.Mock).mockResolvedValue({
        cats: [],
        total: 0,
        currentPage: 1,
        itemsPerPage: 100,
      });

      await controller.getCats(500, 1);
      expect(service.getCats).toHaveBeenCalledWith(100, 1);
    });

    it('should pass through itemsPerPage <= 100', async () => {
      (service.getCats as jest.Mock).mockResolvedValue({
        cats: [],
        total: 0,
        currentPage: 1,
        itemsPerPage: 12,
      });

      await controller.getCats(12, 1);
      expect(service.getCats).toHaveBeenCalledWith(12, 1);
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
      expect(reply.send).toHaveBeenCalledWith('<svg>test</svg>');
    });
  });

  describe('getCatPng', () => {
    it('should throw NotFoundException for unknown cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatPng(999999, reply)).rejects.toThrow(NotFoundException);
    });
  });
});
