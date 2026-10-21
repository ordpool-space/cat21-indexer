import { HttpErrorResponse } from '@angular/common/http';

/** The `{ code, detail }` error shape the marketplace services expose. */
export interface Cat21HttpError<C extends string = string> {
  code: C;
  detail: string;
}

/**
 * Map an HTTP failure into the `{ code, detail }` shape both marketplace
 * services return. The backend sends `{ code, detail }` in the body for
 * BadRequests, so those pass through verbatim. On a 401 (session token
 * rejected by the backend guard) with an address in hand, `clearSession`
 * drops the cached session so the next attempt re-prompts. Anything else
 * collapses to `network-error` with a readable detail.
 */
export function mapCat21HttpError<C extends string>(
  err: unknown,
  addressToClearOn401: string | null | undefined,
  clearSession: (address: string) => void,
): Cat21HttpError<C> {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401 && addressToClearOn401) {
      clearSession(addressToClearOn401);
    }
    const body = err.error as { code?: string; detail?: string } | undefined;
    if (body?.code) {
      return { code: body.code as C, detail: body.detail ?? err.statusText };
    }
    return { code: 'network-error' as C, detail: `${err.status} ${err.statusText}` };
  }
  return { code: 'network-error' as C, detail: err instanceof Error ? err.message : String(err) };
}
