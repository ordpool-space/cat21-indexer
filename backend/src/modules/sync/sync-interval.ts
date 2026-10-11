/** Tick of the cat sync loop when SYNC_INTERVAL_MS is unset: one ord round-trip a minute. */
export const DEFAULT_SYNC_INTERVAL_MS = 60_000;

/**
 * The sync loop's tick in milliseconds: SYNC_INTERVAL_MS when set, otherwise
 * {@link DEFAULT_SYNC_INTERVAL_MS}.
 *
 * Read straight from process.env because `@Interval` takes a constant that is
 * evaluated when the class is defined, before ConfigService exists. The regtest
 * e2e lanes set a short tick so a cat seeded on-chain reaches `/api/cat/:n`
 * within the e2e per-wait bound.
 *
 * Throws on a value that is not a positive integer, so a typo stops the boot
 * instead of falling back to the default unnoticed.
 */
export function readSyncIntervalMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SYNC_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_SYNC_INTERVAL_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(`SYNC_INTERVAL_MS is "${raw}", expected a positive integer of milliseconds`);
  }
  return ms;
}
