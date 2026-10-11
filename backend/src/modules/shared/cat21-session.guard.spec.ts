/**
 * @test-kind unit
 * Real:   Cat21SessionGuard, buildCat21SessionMessage + checkSessionValidity (ordpool-sdk/cat21-session),
 *         verifyBip322Signature (ordpool-sdk/cat21-validation); BIP-322 "simple" signatures made in the spec by
 *         @scure/btc-signer with a fixed test key (taproot key path, SIGHASH_DEFAULT)
 * Faked:  nothing
 * Proves: the guard rejects a malformed, expired or over-dated session and a signature that does not verify over
 *         the canonical message it rebuilds, accepts a valid one and stashes its address; the param decorator returns it
 */
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { schnorr } from '@noble/curves/secp256k1';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { buildCat21SessionMessage } from 'ordpool-sdk/cat21-session';

import { Cat21SessionAddress, Cat21SessionGuard } from './cat21-session.guard';

/** Fixed test key; the spec holds it, so it can sign for ADDR. */
const SESSION_KEY = hex.decode('07'.repeat(32));
const sessionP2tr = btc.p2tr(schnorr.getPublicKey(SESSION_KEY), undefined, btc.NETWORK);
const ADDR = sessionP2tr.address!;
/** A valid P2TR address whose key the spec does not use to sign. */
const OTHER_ADDR = btc.p2tr(schnorr.getPublicKey(hex.decode('08'.repeat(32))), undefined, btc.NETWORK).address!;

/**
 * BIP-322 "simple" signature over `message` for ADDR, as a wallet returns it:
 * the serialized to_sign witness (one 64-byte schnorr signature), base64.
 * Built from the BIP's own recipe (to_spend commits the tagged message hash,
 * to_sign spends it to OP_RETURN), independent of the verifier under test.
 */
function signSession(message: string): string {
  const messageHash = schnorr.utils.taggedHash('BIP0322-signed-message', new TextEncoder().encode(message));
  const toSpend = new btc.Transaction({ version: 0, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true });
  // Output first: @scure treats an input carrying finalScriptSig as signed and
  // refuses outputs added after it.
  toSpend.addOutput({ script: sessionP2tr.script, amount: 0n });
  toSpend.addInput({
    txid: new Uint8Array(32),
    index: 0xffffffff,
    sequence: 0,
    finalScriptSig: btc.Script.encode(['OP_0', messageHash]),
  });

  const toSign = new btc.Transaction({ version: 0, lockTime: 0, allowUnknownOutputs: true });
  toSign.addInput({
    txid: toSpend.id,
    index: 0,
    sequence: 0,
    witnessUtxo: { script: sessionP2tr.script, amount: 0n },
    tapInternalKey: schnorr.getPublicKey(SESSION_KEY),
  });
  toSign.addOutput({ script: btc.Script.encode(['RETURN']), amount: 0n });
  toSign.signIdx(SESSION_KEY, 0);
  const sig = toSign.getInput(0).tapKeySig!;
  return base64.encode(new Uint8Array([0x01, sig.length, ...sig]));
}

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

  it('rejects a signature payload the verifier cannot read, surfacing the SDK reason + detail', () => {
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': futureIso(),
      'x-cat21-session-signature': 'sig',
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'session-malformed-signature',
      detail: expect.stringContaining('base64 decode failed'),
    });
    // a rejected signature must NOT leave an authorized address behind
    expect(req.cat21SessionAddress).toBeUndefined();
  });

  it('rejects a real signature over a different message (the canonical message is rebuilt, not trusted)', () => {
    const validUntilIso = futureIso();
    // Signed by the right key, but for a session that expires an hour later:
    // the guard verifies the message it rebuilds from the headers, so this fails.
    const signature = signSession(buildCat21SessionMessage({ address: ADDR, validUntilIso: futureIso(2 * 60 * 60 * 1000) }));
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': validUntilIso,
      'x-cat21-session-signature': signature,
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      code: 'session-signature-does-not-verify',
      detail: 'BIP-322 verify rejected: signature-does-not-verify',
    });
    expect(req.cat21SessionAddress).toBeUndefined();
  });

  it('rejects a real signature presented for another address', () => {
    const validUntilIso = futureIso();
    const signature = signSession(buildCat21SessionMessage({ address: OTHER_ADDR, validUntilIso }));
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': OTHER_ADDR,
      'x-cat21-session-valid-until': validUntilIso,
      'x-cat21-session-signature': signature,
    });
    let thrown: unknown;
    try { guard.canActivate(ctx); } catch (e) { thrown = e; }
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code: 'session-signature-does-not-verify' });
    expect(req.cat21SessionAddress).toBeUndefined();
  });

  it('accepts a session signed over the canonical message and stashes the verified address', () => {
    const validUntilIso = futureIso();
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': ADDR,
      'x-cat21-session-valid-until': validUntilIso,
      'x-cat21-session-signature': signSession(buildCat21SessionMessage({ address: ADDR, validUntilIso })),
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.cat21SessionAddress).toBe(ADDR);
  });

  it('reads a header delivered as a string array (fastify multi-value): takes the first element', () => {
    const validUntilIso = futureIso();
    const { ctx, req } = ctxWith({
      'x-cat21-session-address': [ADDR, 'second-ignored'],
      'x-cat21-session-valid-until': validUntilIso,
      'x-cat21-session-signature': signSession(buildCat21SessionMessage({ address: ADDR, validUntilIso })),
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
