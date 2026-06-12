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
};
