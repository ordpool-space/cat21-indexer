import { NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ListingsController } from './listings.controller';
import type { ListingsService } from './listings.service';

/**
 * Unit coverage for the controller's own logic: Cache-Control headers on the
 * single-listing hit vs the 404 (no-store, per the cache-poisoning HARD RULE),
 * pagination delegation, and the ownership-scoped delete wiring. The create
 * flow + NoStoreOnErrorFilter live in the service + integration specs.
 */
describe('ListingsController (unit)', () => {
  function make(overrides: Partial<Record<keyof ListingsService, jest.Mock>> = {}) {
    const svc = {
      findByCatNumber: jest.fn(),
      findPaginated: jest.fn(),
      deleteByCatNumberIfOwnedBy: jest.fn(),
      ...overrides,
    } as unknown as ListingsService;
    const controller = new ListingsController(svc);
    const reply = { header: jest.fn() } as unknown as FastifyReply;
    return { controller, svc, reply };
  }

  describe('findByCatNumber', () => {
    it('returns the listing and sets the 60s single-listing Cache-Control on a hit', async () => {
      const listing = { catNumber: 42, askSats: 21_000 } as never;
      const { controller, svc, reply } = make({ findByCatNumber: jest.fn().mockResolvedValue(listing) });

      const out = await controller.findByCatNumber(42, reply);

      expect(out).toBe(listing);
      expect(svc.findByCatNumber).toHaveBeenCalledWith(42);
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'public, max-age=60, s-maxage=60');
    });

    it('throws NotFoundException with no-store (cache-poisoning guard) when there is no listing', async () => {
      const { controller, reply } = make({ findByCatNumber: jest.fn().mockResolvedValue(null) });

      let thrown: unknown;
      try {
        await controller.findByCatNumber(999, reply);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(NotFoundException);
      // the 404 must not be edge-cached, or a later listing gets shadowed
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });

  describe('findPaginated (orderbook browse)', () => {
    it('delegates to the service and returns its paginated result', async () => {
      const page = { total: 5, currentPage: 2, itemsPerPage: 25, items: [] } as never;
      const { controller, svc } = make({ findPaginated: jest.fn().mockResolvedValue(page) });

      const out = await controller.findPaginated(25, 2);

      expect(out).toBe(page);
      expect(svc.findPaginated).toHaveBeenCalledWith(25, 2);
    });
  });

  describe('delete (seller unlists)', () => {
    it('runs the ownership-scoped delete with the session address and sets no-store', async () => {
      const { controller, svc, reply } = make({ deleteByCatNumberIfOwnedBy: jest.fn().mockResolvedValue(true) });

      await controller.delete(42, 'bc1p-session-owner', reply);

      // the session-verified address is what scopes the delete — never a body/query field
      expect(svc.deleteByCatNumberIfOwnedBy).toHaveBeenCalledWith(42, 'bc1p-session-owner');
      expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });
  });
});
