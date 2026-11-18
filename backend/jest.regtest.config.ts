import type { Config } from 'jest';

/**
 * Regtest integration lane: runs ONLY `*.regtest.spec.ts`, which hit a live
 * regtest cat21-ord and electrs (no mock). Runs inside a stack slot
 * (`scripts/backend-regtest-lane.sh`), whose environment names the ports.
 * Kept separate from the pure-unit `jest.config.ts` so CI's unit lane never
 * needs ord and this lane never runs without it.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.regtest\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
  // One worker: every spec shares ONE stack. The DB-backed specs each run the
  // Drizzle migrations against the same fresh `cat21` database, and two
  // workers migrating at once collide on `CREATE TABLE` (the loser fails).
  // They also fund from the same bitcoind wallet, where two workers can pick
  // the same UTXO and double-spend. Serial is the only correct schedule here.
  maxWorkers: 1,
  moduleNameMapper: {
    '^sats-connect$': '<rootDir>/../test/mocks/sats-connect.js',
  },
};

export default config;
