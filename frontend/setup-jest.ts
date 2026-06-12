// Manual ESM-friendly setup for Angular 21 + jest-preset-angular 16.
// Equivalent to `jest-preset-angular/setup-env/zoneless/index` but
// written as ESM so Jest's `extensionsToTreatAsEsm: ['.ts']` can load
// it. The CJS variant in node_modules tries to `require('@angular/
// core')` which fails because Angular 21 ships ESM-only.

// jsdom in jest 29 lacks TextEncoder/TextDecoder on the global; the
// SDK's @noble/curves dep reaches for them at import time. Polyfill
// from node:util before any imports that touch crypto.
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).TextEncoder = NodeTextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).TextDecoder = NodeTextDecoder;
}

import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

getTestBed().resetTestEnvironment();
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting(), {
  teardown: { destroyAfterEach: true },
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
