import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
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
};

export default config;
