import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // `*.regtest.spec.ts` are REAL integration tests against a live regtest
  // cat21-ord; they run only via `npm run test:regtest` (jest.regtest.config.ts),
  // never in the pure-unit lane, which has no ord.
  testPathIgnorePatterns: ['/node_modules/', '\\.regtest\\.spec\\.ts$'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
  // sats-connect is pure ESM; Jest's default CJS transform chokes on
  // it. ordpool-sdk's core bundle transitively pulls it in via the
  // signer graph (wallet.service.helper). For backend specs — none of
  // which exercise a real wallet — swap it for an empty CJS module.
  // The listing verify path (`verifyListingSignature`) doesn't touch
  // sats-connect functionality at all; this mock keeps the transitive
  // chain from tripping.
  moduleNameMapper: {
    '^sats-connect$': '<rootDir>/../test/mocks/sats-connect.js',
  },
  // Coverage is measured over code WE OWN with real logic. Excluded:
  // the bootstrap entrypoint, Nest module wiring (pure DI declarations),
  // DTOs (decorated type declarations, no branches), and the Drizzle
  // schema (table definitions). `*.regtest.spec.ts` sources aren't specs
  // under the unit config anyway.
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!main.ts',
    '!**/*.module.ts',
    '!**/dto/**',
    '!**/drizzle/schema/**',
    '!**/*.d.ts',
  ],
  // Regression floor, enforced in CI via `npm test -- --coverage`. Set a few
  // points below the achieved level so unrelated changes don't redden CI, but
  // a real coverage drop does. Raise these as coverage climbs; never lower them
  // to make a regression pass.
  coverageThreshold: {
    global: { lines: 85, statements: 84, branches: 72, functions: 74 },
  },
};

export default config;
