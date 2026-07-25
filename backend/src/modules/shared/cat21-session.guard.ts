import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  buildCat21SessionMessage,
  checkSessionValidity,
  verifyBip322Signature,
} from 'ordpool-sdk/core';

/**
 * Session-token capability guard for marketplace mutations.
 *
 * Attach via `@UseGuards(Cat21SessionGuard)` on any controller
 * method that must be authenticated by "the address that will perform
 * the action". The client submits three request headers:
 *
 *   X-Cat21-Session-Address       — the ordinals address the caller
 *                                     controls (must match target)
 *   X-Cat21-Session-Valid-Until   — ISO-8601 timestamp the session
 *                                     was signed for
 *   X-Cat21-Session-Signature     — base64 BIP-322 signature over
 *                                     `Cat21 session: I control <addr>,
 *                                      valid until <iso>`
 *
 * The guard rebuilds the canonical message, verifies the signature
 * via the SDK's shared BIP-322 primitive, and rejects if the timestamp
 * is missing / malformed / past / further out than the SDK's cap.
 * The verified address is stashed on `request.cat21SessionAddress`;
 * controllers read it via the `@Cat21SessionAddress()` param decorator
 * and assert it matches the action's target.
 *
 * See workspace CLAUDE.md philosophy: this is a bearer capability for
 * a bounded window. The security investment is the wallet popup at
 * PSBT sign-time, not per-mutation BIP-322 fatigue.
 */
@Injectable()
export class Cat21SessionGuard implements CanActivate {
  private readonly logger = new Logger(Cat21SessionGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest & { cat21SessionAddress?: string }>();

    const address = readHeader(req, 'x-cat21-session-address');
    const validUntilIso = readHeader(req, 'x-cat21-session-valid-until');
    const signatureBase64 = readHeader(req, 'x-cat21-session-signature');

    if (!address || !validUntilIso || !signatureBase64) {
      throw new UnauthorizedException({
        code: 'session-headers-missing',
        detail:
          'Requires X-Cat21-Session-Address, X-Cat21-Session-Valid-Until, and X-Cat21-Session-Signature headers.',
      });
    }

    const validity = checkSessionValidity(validUntilIso, Date.now());
    if (validity !== null) {
      throw new UnauthorizedException({
        code: `session-${validity}`,
        detail: `X-Cat21-Session-Valid-Until: ${validity} (${validUntilIso}).`,
      });
    }

    const message = buildCat21SessionMessage({ address, validUntilIso });
    const result = verifyBip322Signature({ address, message, signatureBase64 });
    if (!result.ok) {
      throw new UnauthorizedException({
        code: `session-${result.reason}`,
        detail: result.detail ?? `BIP-322 verify rejected: ${result.reason}`,
      });
    }

    req.cat21SessionAddress = address;
    return true;
  }
}

/**
 * Param decorator that reads the address the guard verified. Throws
 * on internal misuse (decorator applied to a route without the guard
 * or before the guard ran) — the address is populated only when the
 * guard has approved the request.
 */
export const Cat21SessionAddress = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { cat21SessionAddress?: string }>();
    const addr = req.cat21SessionAddress;
    if (!addr) {
      throw new Error(
        '@Cat21SessionAddress() used on a route without @UseGuards(Cat21SessionGuard)',
      );
    }
    return addr;
  },
);

function readHeader(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === 'string' && v.length > 0) return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0];
  return null;
}
