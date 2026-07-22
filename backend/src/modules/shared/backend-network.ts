import { Network } from 'ordpool-sdk/core';

export type BackendNetworkString = 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';

const ALLOWED: BackendNetworkString[] = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'];

/**
 * Read BACKEND_NETWORK straight from process.env (default `mainnet`).
 * NestJS ConfigService goes through a plainToClass/validateSync chain
 * that in one CI run failed to surface the env override to
 * `ConfigService.get()` — root cause unknown, but process.env has no
 * such indirection so it's the safer read. Same pattern the ord
 * client uses for ORD_API_URL further down the module tree.
 */
export function readBackendNetworkFromEnv(): BackendNetworkString {
  const raw = process.env.BACKEND_NETWORK;
  if (raw && ALLOWED.includes(raw as BackendNetworkString)) {
    return raw as BackendNetworkString;
  }
  return 'mainnet';
}

/**
 * Map the DTO's serialized network string to the SDK's Network enum.
 * Fixed strings for a fixed enum — no dynamic mapping.
 */
export function toSdkNetwork(name: BackendNetworkString): Network {
  switch (name) {
    case 'mainnet': return Network.Mainnet;
    case 'testnet3': return Network.Testnet3;
    case 'testnet4': return Network.Testnet4;
    case 'signet': return Network.Signet;
    case 'regtest': return Network.Regtest;
  }
}

/**
 * Compare two `number[]`s as sets. Called with `cats_on_utxo` values
 * that both sides already claim are sorted-ascending-deduped, but a
 * malformed submission or an ord response drift could still trip a
 * false positive if we relied on element-wise equality alone.
 */
export function catsArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
