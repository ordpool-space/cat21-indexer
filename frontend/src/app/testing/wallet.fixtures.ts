import { jest } from '@jest/globals';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { KnownOrdinalWalletType, WalletInfo } from 'ordpool-sdk';

/**
 * Shared wallet fixture builder for the cat21-indexer frontend's Jest
 * specs. Default is an Xverse split-address wallet — override any
 * field via the `over` param. Kept in one place so adding a new
 * required field to `WalletInfo` (or shifting the SDK's shape) is one
 * edit, not four.
 *
 * The default addresses / pubkeys are structurally plausible
 * placeholders; specs that need real derived values pass their own.
 */
export function makeWallet(over: Partial<WalletInfo> = {}): WalletInfo {
  return {
    type: KnownOrdinalWalletType.xverse,
    ordinalsAddress: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq7pkrz9',
    paymentAddress: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx',
    paymentPublicKey: '02' + 'aa'.repeat(32),
    ordinalsPublicKey: '02' + 'bb'.repeat(32),
    signingSupported: true,
    ...over,
  } as WalletInfo;
}

/**
 * Test double for `WalletService` — bridges every observable the
 * frontend components read (`connectedWallet$`, `wallets$`,
 * `networkMismatch$`, `expectedNetworkGroup`) plus the connect /
 * disconnect / request-connect jest spies.
 *
 * Tests drive it via `walletService.connectedWalletSubject.next(...)`
 * to simulate a wallet connecting or swapping.
 */
export class WalletServiceStub {
  readonly connectedWalletSubject = new BehaviorSubject<WalletInfo | null>(null);
  readonly connectedWallet$ = this.connectedWalletSubject.asObservable();
  readonly wallets$ = new BehaviorSubject({ installedWallets: [], notInstalledWallets: [] }).asObservable();
  readonly networkMismatch$ = new BehaviorSubject(false).asObservable();
  readonly expectedNetworkGroup = signal<'mainnet' | 'testnet' | 'regtest'>('mainnet');
  connectWallet = jest.fn();
  disconnectWallet = jest.fn();
  requestWalletConnect = jest.fn();
}
