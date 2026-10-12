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
  moduleNameMapper: {
    '^sats-connect$': '<rootDir>/../test/mocks/sats-connect.js',
    // The stack's host ports, from its slot (E2E_*_HOST_PORT). `ordpool-sdk/e2e`
    // re-exports this module, but its index also loads the Playwright helpers,
    // which the backend does not install; stack-ports.js is pure.
    '^ordpool-sdk/stack-ports$': '<rootDir>/../node_modules/ordpool-sdk/dist-e2e/stack-ports.js',
  },
};

export default config;
