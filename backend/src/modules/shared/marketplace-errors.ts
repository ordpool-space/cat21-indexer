import { BadRequestException } from '@nestjs/common';

/**
 * Shared 400 responses for the pre-sign on-chain checks that bids and
 * listings both run against ord. One source keeps the error `code`
 * values, which the frontend branches on, identical across both
 * endpoints; the human-facing `detail` is passed in because each
 * endpoint phrases the next step for its own flow.
 */
export function throwOrdLookupFailed(): never {
  throw new BadRequestException({
    code: 'ord-lookup-failed',
    detail: 'On-chain cats-bundle check could not complete. Try again in a moment.',
  });
}

export function throwCatNotFound(detail: string): never {
  throw new BadRequestException({ code: 'cat-not-found', detail });
}
