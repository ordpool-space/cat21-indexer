import { BadRequestException } from '@nestjs/common';

/**
 * Validate 1-based pagination inputs and return the row offset. The
 * orderbook list endpoints (bids, listings) share the same bounds:
 * `itemsPerPage` in [1, 100], `currentPage` a positive integer. A
 * single source keeps the limit and the two error messages in step
 * across every paginated endpoint.
 */
export function paginationOffset(itemsPerPage: number, currentPage: number): number {
  if (!Number.isInteger(itemsPerPage) || itemsPerPage < 1 || itemsPerPage > 100) {
    throw new BadRequestException('itemsPerPage must be an integer in [1, 100]');
  }
  if (!Number.isInteger(currentPage) || currentPage < 1) {
    throw new BadRequestException('currentPage must be a positive integer');
  }
  return (currentPage - 1) * itemsPerPage;
}
