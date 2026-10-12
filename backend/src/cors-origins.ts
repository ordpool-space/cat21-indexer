/**
 * Origins whose browsers may call this API cross-origin: the two production
 * sites and the two local dev servers. Exact strings; an origin must match one
 * byte for byte.
 *
 * Wildcard CORS combined with the capability-mutating routes (POST /listings,
 * DELETE /listings, DELETE /bids) would let a hostile page drive any visitor's
 * browser to make cross-origin requests to this backend as that visitor.
 * Session tokens (X-Cat21-Session-*) authenticate the action, so the practical
 * damage window is narrow, but there is no reason to allow drive-by
 * cross-origin calls from arbitrary sites.
 */
export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  'https://cat21.space',
  'https://ordpool.space',
  // `ng serve` on the frontend.
  'http://localhost:4200',
  'http://localhost:4221',
];

/**
 * The allowlist: {@link DEFAULT_CORS_ORIGINS} plus the comma-separated exact
 * origins in `CORS_EXTRA_ORIGINS`, which a deployment sets when it serves the
 * frontend from somewhere else (a regtest lane serves it on its slot's
 * `E2E_APP_PORT`). Unset or empty adds nothing, so production answers exactly
 * the defaults.
 *
 * Each extra entry must be a bare origin (`scheme://host[:port]`, no path, no
 * trailing slash): the browser's `Origin` header has that form, so anything
 * else could never match and is a configuration error, refused at startup.
 */
export function corsAllowedOrigins(extra: string | undefined): string[] {
  const added = (extra ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  for (const origin of added) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_EXTRA_ORIGINS: "${origin}" is not an origin`);
    }
    if (parsed.origin !== origin) {
      throw new Error(`CORS_EXTRA_ORIGINS: "${origin}" is not a bare origin (expected "${parsed.origin}")`);
    }
  }
  return [...new Set([...DEFAULT_CORS_ORIGINS, ...added])];
}
