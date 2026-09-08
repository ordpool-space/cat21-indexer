import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

/**
 * Mock ONLY the crypto boundary (`verifyBip322Signature`). The pure,
 * deterministic helpers `checkSessionValidity` + `buildCat21SessionMessage`
 * stay REAL (via requireActual) so the guard's validity gate and canonical
 * message rebuild are exercised for real, not stubbed. The mocked return
 * shape is the SDK's exact `VerifyBip322SignatureResult` contract
 * (`ok: true | { ok: false, reason, detail? }`, from
 * verify-bip322-signature.d.ts), not an invented shape.
 */
jest.mock('ordpool-sdk/core', () => ({
  ...jest.requireActual('ordpool-sdk/core'),
  verifyBip322Signature: jest.fn(),
}));

import { buildCat21SessionMessage, verifyBip322Signature } from 'ordpool-sdk/core';

import { Cat21SessionAddress, Cat21SessionGuard } from './cat21-session.guard';

const mockVerify = verifyBip322Signature as jest.MockedFunction<typeof verifyBip322Signature>;

const ADDR = 'bc1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c';

function ctxWith(headers: Record<string, string | string[] | undefined>): {
  ctx: ExecutionContext;
  req: { headers: unknown; cat21SessionAddress?: string };
} {
  const req: { headers: unknown; cat21SessionAddress?: string } = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

/** ISO timestamp `msFromNow` in the future (default 1h): inside checkSessionValidity's window, under the SDK cap. */
function futureIso(msFromNow = 60 * 60 * 1000): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

/** Pull the inner factory out of the createParamDecorator so it can be called directly. */
function getAddressFactory(): (data: unknown, ctx: ExecutionContext) => string {
  class Probe {
    // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
    handler(@Cat21SessionAddress() _addr: string): void {}
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  const key = Object.keys(meta)[0];
  return meta[key].factory as (data: unknown, ctx: ExecutionContext) => string;
}

describe('Cat21SessionGuard', () => {
  let guard: Cat21SessionGuard;

  beforeEach(() => {
    guard = new Cat21SessionGuard();
    mockVerify.mockReset();
  });

  it.each([
    ['all three missing', {}],
    ['only address', { 'x-cat21-session-address': ADDR }],
    ['address + validUntil, no signature', { 'x-cat21-session-address': ADDR, 'x-cat21-session-valid-until': futureIso() }],
    ['validUntil + signature, no address', { 'x-cat21-session-valid-until': futureIso(), 'x-cat21-session-signature': 'sig' }],
    ['empty-string address', { 'x-cat21-session-address': '', 'x-cat21-session-valid-until': futureIso(), 'x-cat21-session-signature': 'sig' }],
  ])('rejects with session-headers-missing when %s', (_label, headers) => {
    const { ctx } = ctxWith(headers);
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code: 'session-headers-missing' });
  });

  it('rejects a malformed timestamp before ever touching the signature', () => {
    const { ctx } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': 'not-a-real-date',
      'x-cat21-session-signature': 'sig',
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code: 'session-malformed-timestamp' });
  });

  it('rejects an expired session (code carries the validity reason)', () => {
    const { ctx } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': new Date(Date.now() - 1000).toISOString(),
      'x-cat21-session-signature': 'sig',
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    // guard builds `session-${validity}`; validity for a past stamp is 'session-expired'
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code: 'session-session-expired' });
  });

  it('rejects a session dated further out than the SDK cap', () => {
    const { ctx } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': futureIso(1000 * 60 * 60 * 24 * 3650), // ~10 years
      'x-cat21-session-signature': 'sig',
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code: 'session-session-too-far-in-future' });
  });

  it('rejects when BIP-322 verification fails, surfacing the SDK reason + detail', () => {
    mockVerify.mockReturnValue({ ok: false, reason: 'signature-does-not-verify', detail: 'schnorr verify failed' });
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': futureIso(),
      'x-cat21-session-signature': 'sig',
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'session-signature-does-not-verify',
      detail: 'schnorr verify failed',
    });
    // a rejected signature must NOT leave an authorized address behind
    expect(req.cat21SessionAddress).toBeUndefined();
  });

  it('accepts a valid session, stashes the verified address, and verifies the rebuilt canonical message', () => {
    mockVerify.mockReturnValue({ ok: true });
    const validUntilIso = futureIso();
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': validUntilIso,
      'x-cat21-session-signature': 'base64signature',
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.cat21SessionAddress).toBe(ADDR);
    // the guard rebuilds the message from the headers and verifies THAT exact message,
    // not any client-supplied one (real buildCat21SessionMessage, not a stub).
    expect(mockVerify).toHaveBeenCalledWith({
      address: ADDR,
      message: buildCat21SessionMessage({ address: ADDR, validUntilIso }),
      signatureBase64: 'base64signature',
    });
  });

  it('reads a header delivered as a string array (fastify multi-value): takes the first element', () => {
    mockVerify.mockReturnValue({ ok: true });
    const validUntilIso = futureIso();
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': [ADDR, 'second-ignored'],
      'x-cat21-session-valid-until': validUntilIso,
      'x-cat21-session-signature': 'sig',
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.cat21SessionAddress).toBe(ADDR);
  });
});

describe('@Cat21SessionAddress() param decorator', () => {
  it('returns the address the guard stashed on the request', () => {
    const factory = getAddressFactory();
    const req = { cat21SessionAddress: ADDR };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    expect(factory(undefined, ctx)).toBe(ADDR);
  });

  it('throws (internal misuse) when the guard never populated the address', () => {
    const factory = getAddressFactory();
    const req = { headers: {} };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    expect(() => factory(undefined, ctx)).toThrow(/without @UseGuards\(Cat21SessionGuard\)/);
  });
});
