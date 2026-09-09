import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as sharp from 'sharp';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';
import { GENESIS_DTO } from './__fixtures__/genesis-cat';

const mockCat = GENESIS_DTO;

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
        'public, max-age=60, s-maxage=300',
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

      const result = await controller.getCatByTxHash(mockCat.txHash, reply);
      expect(result).toEqual(mockCat);
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=60, s-maxage=300',
      );
    });

    it('should throw NotFoundException for unknown tx hash', async () => {
      (service.getCatByTxHash as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatByTxHash(mockCat.txHash, reply)).rejects.toThrow(NotFoundException);
    });

    it('should reject invalid tx hash (too short)', async () => {
      const reply = createMockReply();
      await expect(controller.getCatByTxHash('abc123', reply)).rejects.toThrow(NotFoundException);
      expect(service.getCatByTxHash).not.toHaveBeenCalled();
    });

    it('should reject invalid tx hash (uppercase)', async () => {
      const reply = createMockReply();
      await expect(
        controller.getCatByTxHash(mockCat.txHash.toUpperCase(), reply),
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
        'public, max-age=86400, s-maxage=31536000, immutable',
      );
      expect(reply.send).toHaveBeenCalledWith('<svg>test</svg>');
    });
  });

  describe('getCatWebp', () => {
    it('should throw NotFoundException for unknown cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatWebp(999999, reply)).rejects.toThrow(NotFoundException);
    });

    it('should send WebP with correct headers for valid cat', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="red"/></svg>',
      );
      const reply = createMockReply();

      await controller.getCatWebp(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(reply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="cat21-0.webp"',
      );
      expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should throw InternalServerErrorException for invalid SVG', async () => {
      (service.getCatSvg as jest.Mock).mockResolvedValue('not-valid-svg');
      const reply = createMockReply();

      await expect(controller.getCatWebp(0, reply)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getCatSocialCard', () => {
    const validSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="red"/></svg>';

    it('should throw NotFoundException when the cat does not exist', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatSocialCard(999999, reply)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the SVG is missing', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue(mockCat);
      (service.getCatSvg as jest.Mock).mockResolvedValue(null);
      const reply = createMockReply();

      await expect(controller.getCatSocialCard(0, reply)).rejects.toThrow(NotFoundException);
    });

    it('should send a PNG card with immutable headers for a valid cat', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue(mockCat);
      (service.getCatSvg as jest.Mock).mockResolvedValue(validSvg);
      const reply = createMockReply();

      await controller.getCatSocialCard(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(reply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="cat21-0-social.png"',
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Cache-Control',
        'public, max-age=86400, s-maxage=31536000, immutable',
      );
      expect(reply.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    it('should render a 1200x630 card', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue(mockCat);
      (service.getCatSvg as jest.Mock).mockResolvedValue(validSvg);
      const reply = createMockReply();

      await controller.getCatSocialCard(0, reply);
      const sent = (reply.send as jest.Mock).mock.calls[0][0] as Buffer;
      const meta = await sharp(sent).metadata();
      expect(meta.width).toBe(1200);
      expect(meta.height).toBe(630);
    });

    it('should full-bleed the card in the cat background colour (genesis-orange fallback when none)', async () => {
      (service.getCatByNumber as jest.Mock).mockResolvedValue({ ...mockCat, backgroundColors: [] });
      (service.getCatSvg as jest.Mock).mockResolvedValue(validSvg);
      const reply = createMockReply();

      await controller.getCatSocialCard(0, reply);
      // The (0,0) corner is untouched by the centred cat, so it exposes the
      // full-bleed background — genesis-orange #ff9900 = rgb(255,153,0).
      const sent = (reply.send as jest.Mock).mock.calls[0][0] as Buffer;
      const { data } = await sharp(sent).raw().toBuffer({ resolveWithObject: true });
      expect([data[0], data[1], data[2]]).toEqual([255, 153, 0]);
    });
  });

});

describe('CatsController — extended health, image endpoints, pagination clamps', () => {
  const VALID_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#ff9900"/></svg>';

  function make(svc: Partial<CatsService> = {}) {
    const service = {
      getExtendedHealth: jest.fn(),
      getCatByNumber: jest.fn(),
      getCatSvg: jest.fn(),
      getCats: jest.fn(),
      getCatNumbers: jest.fn(),
      ...svc,
    } as unknown as CatsService;
    return { controller: new CatsController(service), service };
  }

  describe('getExtendedHealth', () => {
    it('sets no-store and returns the report when healthy', async () => {
      const health = { status: 'ok' } as never;
      const { controller, service } = make({ getExtendedHealth: jest.fn().mockResolvedValue(health) });
      const reply = createMockReply();
      const out = await controller.getExtendedHealth(reply);
      expect(out).toBe(health);
      expect(service.getExtendedHealth).toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('throws 503 ServiceUnavailable (carrying the report) when status is down', async () => {
      const health = { status: 'down', db: { reachable: false } } as never;
      const { controller } = make({ getExtendedHealth: jest.fn().mockResolvedValue(health) });
      const reply = createMockReply();
      const { ServiceUnavailableException } = await import('@nestjs/common');
      let thrown: unknown;
      try { await controller.getExtendedHealth(reply); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as InstanceType<typeof ServiceUnavailableException>).getResponse()).toMatchObject({ status: 'down' });
    });
  });

  describe('getCatSvg', () => {
    it('sends the svg with immutable cache + svg content-type', async () => {
      const { controller } = make({ getCatSvg: jest.fn().mockResolvedValue(VALID_SVG) });
      const reply = createMockReply();
      await controller.getCatSvg(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/svg+xml');
      expect(reply.send).toHaveBeenCalledWith(VALID_SVG);
    });

    it('404s with no-store when the cat has no svg', async () => {
      const { controller } = make({ getCatSvg: jest.fn().mockResolvedValue(null) });
      const reply = createMockReply();
      await expect(controller.getCatSvg(999, reply)).rejects.toBeInstanceOf(NotFoundException);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('getCatWebp', () => {
    it('renders a WebP buffer from the svg and sends it with immutable cache', async () => {
      const { controller } = make({ getCatSvg: jest.fn().mockResolvedValue(VALID_SVG) });
      const reply = createMockReply();
      await controller.getCatWebp(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/webp');
      const sent = reply.send.mock.calls[0][0];
      expect(Buffer.isBuffer(sent)).toBe(true);
      expect(sent.length).toBeGreaterThan(0);
    });

    it('404s with no-store when the cat has no svg', async () => {
      const { controller } = make({ getCatSvg: jest.fn().mockResolvedValue(null) });
      const reply = createMockReply();
      await expect(controller.getCatWebp(999, reply)).rejects.toBeInstanceOf(NotFoundException);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('500s with no-store when the svg cannot be rendered', async () => {
      const { controller } = make({ getCatSvg: jest.fn().mockResolvedValue('this is not valid svg or image data') });
      const reply = createMockReply();
      await expect(controller.getCatWebp(0, reply)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('getCatSocialCard', () => {
    it('composites a 1200x630 PNG card and sends it', async () => {
      const { controller } = make({
        getCatByNumber: jest.fn().mockResolvedValue({ backgroundColors: ['#123456'] }),
        getCatSvg: jest.fn().mockResolvedValue(VALID_SVG),
      });
      const reply = createMockReply();
      await controller.getCatSocialCard(0, reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/png');
      const sent = reply.send.mock.calls[0][0] as Buffer;
      // PNG magic + IHDR: signature is 8 bytes; width/height are big-endian
      // u32 at byte offsets 16 and 20. Pins the 1200x630 og:image card size.
      expect(sent.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(sent.readUInt32BE(16)).toBe(1200);
      expect(sent.readUInt32BE(20)).toBe(630);
    });

    it('404s with no-store when the cat is missing', async () => {
      const { controller } = make({ getCatByNumber: jest.fn().mockResolvedValue(null) });
      const reply = createMockReply();
      await expect(controller.getCatSocialCard(999, reply)).rejects.toBeInstanceOf(NotFoundException);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('500s with no-store when the art cannot be rendered', async () => {
      const { controller } = make({
        getCatByNumber: jest.fn().mockResolvedValue({ backgroundColors: ['#123456'] }),
        getCatSvg: jest.fn().mockResolvedValue('not valid svg'),
      });
      const reply = createMockReply();
      await expect(controller.getCatSocialCard(0, reply)).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('pagination clamps', () => {
    it('getCats clamps itemsPerPage to <=100 and page to >=1', async () => {
      const { controller, service } = make({ getCats: jest.fn().mockResolvedValue({ items: [] }) });
      await controller.getCats(500, 0);
      expect(service.getCats).toHaveBeenCalledWith(100, 1);
    });

    it('getCats raises itemsPerPage to >=1', async () => {
      const { controller, service } = make({ getCats: jest.fn().mockResolvedValue({ items: [] }) });
      await controller.getCats(0, 3);
      expect(service.getCats).toHaveBeenCalledWith(1, 3);
    });

    it('getCatNumbers clamps + maps sort=rarity through, defaulting everything else to newest', async () => {
      const { controller, service } = make({ getCatNumbers: jest.fn().mockResolvedValue({ items: [] }) });
      await controller.getCatNumbers(500, 0, 'rarity');
      expect(service.getCatNumbers).toHaveBeenCalledWith(100, 1, 'rarity');
      await controller.getCatNumbers(25, 1, 'something-else');
      expect(service.getCatNumbers).toHaveBeenCalledWith(25, 1, 'newest');
    });
  });
});
