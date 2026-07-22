import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { NoStoreOnErrorFilter } from '../shared/no-store-on-error.filter';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';

/**
 * Mirror of `listings.controller.integration.spec.ts` — proves the
 * NoStoreOnErrorFilter fires on every error path the bids controller
 * exposes (validation, service throw, throttler, 500). Uses a fresh
 * app per test because ThrottlerModule holds per-IP counters in
 * memory that would otherwise leak state between `it` blocks.
 */
describe('BidsController — error responses carry Cache-Control: no-store (integration)', () => {

  let app: INestApplication & NestFastifyApplication;
  let mockCreate: jest.Mock;

  beforeEach(async () => {
    mockCreate = jest.fn();
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
      ],
      controllers: [BidsController],
      providers: [
        {
          provide: BidsService,
          useValue: {
            create: mockCreate,
            findByOutpoint: jest.fn(),
            findPaginated: jest.fn(),
            deleteByOutpointAndBuyer: jest.fn(),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new NoStoreOnErrorFilter(app.get(HttpAdapterHost)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  const validDtoBody = () => ({
    network: 'mainnet',
    catTxid: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df',
    catVout: 0,
    cats: [42],
    headlineCatNumber: 42,
    bidSats: 21_000,
    buyerOrdinalsAddress: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    buyerPaymentAddress: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx',
    sellerPaymentAddress: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
    psbtBase64: 'cHNidP8BAP0Y',
  });

  it('400 from ValidationPipe (missing required field) carries no-store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bids',
      payload: { network: 'mainnet' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('400 from a service-thrown BadRequestException carries no-store', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    mockCreate.mockRejectedValue(new BadRequestException({ code: 'cats-bundle-drift', detail: 'stale' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bids',
      payload: validDtoBody(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toMatchObject({ code: 'cats-bundle-drift' });
  });

  it('429 from ThrottlerGuard (6th request within window) carries no-store', async () => {
    mockCreate.mockResolvedValue({
      id: 'x',
      network: 'mainnet',
      catTxid: '',
      catVout: 0,
      cats: [42],
      headlineCatNumber: 42,
      bidSats: 21_000,
      buyerOrdinalsAddress: '',
      buyerPaymentAddress: '',
      sellerPaymentAddress: '',
      psbtBase64: '',
      createdAt: '',
    });

    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({ method: 'POST', url: '/api/v1/bids', payload: validDtoBody() });
      expect(ok.statusCode).toBe(201);
      expect(ok.headers['cache-control']).toBe('no-store');
    }
    const throttled = await app.inject({ method: 'POST', url: '/api/v1/bids', payload: validDtoBody() });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['cache-control']).toBe('no-store');
  });

  it('500 from an unexpected non-HttpException carries no-store', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bids',
      payload: validDtoBody(),
    });
    expect(res.statusCode).toBe(500);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
