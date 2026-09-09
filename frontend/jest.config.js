const { createEsmPreset } = require('jest-preset-angular/presets');

module.exports = {
  ...createEsmPreset({
    tsconfig: '<rootDir>/tsconfig.spec.json',
  }),
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['<rootDir>/playwright/', '<rootDir>/e2e/', '<rootDir>/node_modules/', '<rootDir>/dist/'],
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  // jest-preset-angular's createEsmPreset already handles Angular ESM;
  // extend the ignore-list so @noble/*, @scure/*, sats-connect, rxjs,
  // and the SDK get transformed too — otherwise their bare `export`
  // syntax fails at import.
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$|@angular|@noble/.*|@scure/.*|sats-connect|rxjs|ordpool-sdk))',
  ],
  moduleNameMapper: {
    'rxjs/operators': '<rootDir>/node_modules/rxjs/dist/cjs/operators/index.js',
  },
  // Coverage is measured over code WE OWN. The OpenAPI-generated client
  // (src/app/shared/cat21-api/**, stamped "Do not edit the class manually")
  // is never tested and never counted: it is valid by definition of its
  // generator. See the workspace CLAUDE.md HARD RULE "Never test
  // code-generated code". main.ts is the bootstrap entrypoint.
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/shared/cat21-api/**',
    '!src/main.ts',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/app/shared/cat21-api/',
  ],
  // Regression floor, enforced in CI via `npm test -- --coverage`. Owned-code
  // only (codegen excluded above). Route/page components are covered by the
  // e2e regtest lanes, not unit tests, so this floor tracks the services +
  // pure logic + pipes. Set below the achieved level as a ratchet: raise it as
  // coverage climbs; never lower it to make a regression pass.
  coverageThreshold: {
    global: { lines: 45, statements: 44, branches: 40, functions: 42 },
  },
};
