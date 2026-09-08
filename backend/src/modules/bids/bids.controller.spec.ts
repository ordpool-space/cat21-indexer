import { UnauthorizedException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { BidsController } from './bids.controller';
import type { BidsService } from './bids.service';

/**
 * Unit coverage for the controller's own logic: the response Cache-Control
 * headers and the delete-time session/buyer authorization check. The
 * NoStoreOnErrorFilter error paths live in the integration spec; the create
 * flow lives in bids.service.spec. Here BidsService is a plain mock (its
 * `network` getter is a fixed property) and the fastify reply is a header spy.
 */
describe('BidsController (unit)', () => {
  const CAT_TXID = 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df';
  const BUYER = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9';

  function make(overrides: Partial<Record<keyof BidsService, jest.Mock>> = {}) {
    const svc = {
      network: 'mainnet',
      findByOutpoint: jest.fn(),
      findPaginated: jest.fn(),
      deleteByOutpointAndBuyer: jest.fn(),
      ...overrides,
    } as unknown as BidsService;
    const controller = new BidsController(svc);
    const reply = { header: jest.fn() } as unknown as FastifyReply;
    return { controller, svc, reply };
  }

  describe('findByOutpoint (seller view)', () => {
    it('returns the service rows and sets the 60s single-bid Cache-Control', async () => {
      const rows = [{ id: 'b1', bidSats: 21_000 }] as never;
      const { controller, svc, reply } = make({ findByOutpoint: jest.fn().mockResolvedValue(rows) });

      const out = await controller.findByOutpoint(CAT_TXID, 0, reply);

      expect(out).toBe(rows);
      expect(svc.findByOutpoint).toHaveBeenCalledWith('mainnet', CAT_TXID, 0);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60, s-maxage=60');
    });
  });

  describe('findPaginated (orderbook browse)', () => {
    it('delegates to the service and returns its paginated result (no Cache-Control set)', async () => {
      const page = { total: 3, currentPage: 1, itemsPerPage: 25, items: [] } as never;
      const { controller, svc } = make({ findPaginated: jest.fn().mockResolvedValue(page) });

      const out = await controller.findPaginated(25, 1);

      expect(out).toBe(page);
      expect(svc.findPaginated).toHaveBeenCalledWith(25, 1);
    });
  });

  describe('delete (buyer cancels)', () => {
    it('rejects session-address-mismatch and does NOT delete when the session address != ?buyer=', async () => {
      const { controller, svc, reply } = make();

      let thrown: unknown;
      try {
        await controller.delete(CAT_TXID, 0, BUYER, 'bc1p-a-different-session-address', reply);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(UnauthorizedException);
      expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code: 'session-address-mismatch' });
      // the guarantee: an unauthorized session must never reach the delete
      expect(svc.deleteByOutpointAndBuyer).not.toHaveBeenCalled();
    });

    it('deletes with the unique-key fields and sets no-store when the session address matches ?buyer=', async () => {
      const { controller, svc, reply } = make();

      await controller.delete(CAT_TXID, 0, BUYER, BUYER, reply);

      expect(svc.deleteByOutpointAndBuyer).toHaveBeenCalledWith('mainnet', CAT_TXID, 0, BUYER);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });
});
