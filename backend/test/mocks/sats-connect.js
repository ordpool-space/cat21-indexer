// Empty CJS mock for `sats-connect` — used by the jest.config.ts
// moduleNameMapper to sidestep the package's ESM-only distribution
// when the SDK's core bundle transitively requires it. Backend specs
// never invoke a real wallet, so an empty module is fine.
module.exports = {};
