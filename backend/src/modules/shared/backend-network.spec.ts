import { Network } from 'ordpool-sdk/core';

import { readBackendNetworkFromEnv, toSdkNetwork, type BackendNetworkString } from './backend-network';

describe('backend-network', () => {

  describe('readBackendNetworkFromEnv', () => {
    const original = process.env.BACKEND_NETWORK;
    afterEach(() => {
      if (original === undefined) delete process.env.BACKEND_NETWORK;
      else process.env.BACKEND_NETWORK = original;
    });

    it('defaults to mainnet when BACKEND_NETWORK is unset', () => {
      delete process.env.BACKEND_NETWORK;
      expect(readBackendNetworkFromEnv()).toBe('mainnet');
    });

    it.each(['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as BackendNetworkString[])(
      'returns %s verbatim when it is an allowed value',
      (net) => {
        process.env.BACKEND_NETWORK = net;
        expect(readBackendNetworkFromEnv()).toBe(net);
      },
    );

    it.each(['', 'Mainnet', 'testnet', 'liquid', 'nonsense'])(
      'falls back to mainnet for the disallowed value %p (never passes it through)',
      (bad) => {
        process.env.BACKEND_NETWORK = bad;
        expect(readBackendNetworkFromEnv()).toBe('mainnet');
      },
    );
  });

  describe('toSdkNetwork', () => {
    it.each([
      ['mainnet', Network.Mainnet],
      ['testnet3', Network.Testnet3],
      ['testnet4', Network.Testnet4],
      ['signet', Network.Signet],
      ['regtest', Network.Regtest],
    ] as [BackendNetworkString, Network][])('maps %s to the matching SDK Network enum', (name, expected) => {
      expect(toSdkNetwork(name)).toBe(expected);
    });

    it('maps each distinct backend string to a DISTINCT enum value (no two collapse together)', () => {
      const all: BackendNetworkString[] = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'];
      const mapped = all.map(toSdkNetwork);
      expect(new Set(mapped).size).toBe(all.length);
    });
  });
});
