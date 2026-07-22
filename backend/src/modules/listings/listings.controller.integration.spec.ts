import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import { NoStoreOnErrorFilter } from '../shared/no-store-on-error.filter';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

/**
 * Integration test that boots a MINIMAL Fastify Nest app with:
 *   - ThrottlerModule (5/min/IP on the POST route)
 *   - The real ListingsController
 *   - The real NoStoreOnErrorFilter installed globally
 *   - The real ValidationPipe (400 on bad DTO)
 *
 * `ListingsService` is mocked at the DI seam — we're NOT testing the
 * service logic here, we're proving the HTTP wiring correctly applies
 * `Cache-Control: no-store` to error paths that bypass the controller
 * method body:
 *
 *   1. 400 from ValidationPipe (pipe throws → controller never runs)
 *   2. 429 from ThrottlerGuard (guard throws → controller never runs)
 *   3. 400 from a BadRequestException the service throws (controller
 *      runs, catch clause fires — this ALSO passes through the filter
 *      because the controller re-throws)
 *
 * Every one of the above must have `Cache-Control: no-store` per the
 * backend HARD RULE. This test proves it end-to-end.
 */
describe('ListingsController — error responses carry Cache-Control: no-store (integration)', () => {

  let app: INestApplication & NestFastifyApplication;
  let mockCreate: jest.Mock;

  // Fresh app per test — the ThrottlerModule holds per-IP counters in
  // memory that carry across `it` blocks under app.inject's synthesized
  // 127.0.0.1 client, so a shared app.beforeAll would leak throttle
  // state (test N+1 sees test N's 6 requests still counting against
  // the limit). ~200ms boot overhead per test; acceptable for
  // integration coverage.
  beforeEach(async () => {
    mockCreate = jest.fn();
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
      ],
      controllers: [ListingsController],
      providers: [
        { provide: ListingsService, useValue: { create: mockCreate, findByCatNumber: jest.fn(), findPaginated: jest.fn(), deleteByCatNumber: jest.fn() } },
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

  // Minimal valid-shape DTO that class-validator accepts. Signature verify
  // will still fail server-side — but that's a service-level concern and
  // we mock the service anyway.
  const validDtoBody = () => ({
    catNumber: 42,
    cats: [42],
    network: 'mainnet',
    askSats: 21_000,
    payTo: 'bc1qz69ej270c3q9qvgt822t6pm3zdksk2x35j2jlm',
    catTxid: 'ab49227cce490e2137872f7d08924187ee4f4bc7e8b3bda7ac63d7bba1d897df',
    catVout: 0,
    ordinalsAddress: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    signedAt: Math.floor(Date.now() / 1000),
    signature: 'AUHd69PrJQEv+oKTfZ8l+WROBHuy9HKrbFCJu7U1iK2iiEy1vMU5EfMtjc+VSHM7aU0SDbak5IUZRVno2P5mjSafAQ==',
  });

  it('400 from ValidationPipe (missing required field) carries no-store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/listings',
      payload: { catNumber: 42 }, // missing everything else — pipe rejects
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('400 from a service-thrown BadRequestException carries no-store', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    mockCreate.mockRejectedValue(new BadRequestException({ code: 'network-mismatch', detail: 'wrong network' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/listings',
      payload: validDtoBody(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toMatchObject({ code: 'network-mismatch' });
  });

  it('429 from ThrottlerGuard (6th request within window) carries no-store', async () => {
    // First 5 all "succeed" (service returns a stub), 6th trips the limit.
    mockCreate.mockResolvedValue({ id: 'x', catNumber: 42, cats: [42], network: 'mainnet', askSats: 21_000, payTo: '', catTxid: '', catVout: 0, ordinalsAddress: '', signedAt: 0, signature: '', createdAt: '' });

    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({ method: 'POST', url: '/api/v1/listings', payload: validDtoBody() });
      expect(ok.statusCode).toBe(201);
      // Happy-path also gets no-store from the controller's try/catch.
      expect(ok.headers['cache-control']).toBe('no-store');
    }
    // 6th call — throttler throws before the controller body runs.
    const throttled = await app.inject({ method: 'POST', url: '/api/v1/listings', payload: validDtoBody() });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['cache-control']).toBe('no-store');
  });

  it('500 from an unexpected non-HttpException carries no-store', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/listings',
      payload: validDtoBody(),
    });
    expect(res.statusCode).toBe(500);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
