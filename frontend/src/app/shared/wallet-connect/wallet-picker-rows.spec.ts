import { describe, it, expect } from '@jest/globals';
import {
  KnownOrdinalWalletType,
  WALLET_MATRIX,
  WalletCapability,
  WalletPlatform,
  walletInAppBrowserDeepLink,
} from 'ordpool-sdk';

import {
  actionCapabilityLineFor,
  buildInjectedPickerRows,
  capabilityLinesFor,
} from './wallet-picker-rows';

// These pin the picker-row view-model against the LIVE SDK matrix (at the
// pinned SHA) — no mocking of the SUT's data source. A matrix change that
// (un)blocks a wallet, reorders the set, or a wording drift surfaces here.

const TARGET_URL = 'https://cat21.space/dashboard/trade/make-offer';

const rowTypes = (
  platform: WalletPlatform,
  installed: KnownOrdinalWalletType[] = [],
  capability?: WalletCapability,
) =>
  buildInjectedPickerRows(
    WALLET_MATRIX,
    platform,
    new Set(installed),
    capability,
    TARGET_URL,
    walletInAppBrowserDeepLink,
  ).map((r) => r.entry.wallet);

describe('buildInjectedPickerRows — deep-link resolution', () => {
  it('Mobile + not-installed + Xverse → the exact SDK deep-link URL (verified scheme)', () => {
    const rows = buildInjectedPickerRows(
      WALLET_MATRIX, WalletPlatform.Mobile, new Set(), undefined, TARGET_URL, walletInAppBrowserDeepLink,
    );
    const xverse = rows.find((r) => r.entry.wallet === KnownOrdinalWalletType.xverse);
    expect(xverse!.deepLink).toBe(walletInAppBrowserDeepLink(KnownOrdinalWalletType.xverse, TARGET_URL));
    expect(xverse!.deepLink).toBe(`https://connect.xverse.app/browser?url=${TARGET_URL}`);
  });

  it('Desktop + not-installed + Xverse → null (extensions install normally; row stays Download)', () => {
    const rows = buildInjectedPickerRows(
      WALLET_MATRIX, WalletPlatform.Desktop, new Set(), undefined, TARGET_URL, walletInAppBrowserDeepLink,
    );
    const xverse = rows.find((r) => r.entry.wallet === KnownOrdinalWalletType.xverse);
    expect(xverse!.deepLink).toBeNull();
  });

  it('Mobile + not-installed + a wallet with no verified scheme (OKX) → null', () => {
    const rows = buildInjectedPickerRows(
      WALLET_MATRIX, WalletPlatform.Mobile, new Set(), undefined, TARGET_URL, walletInAppBrowserDeepLink,
    );
    const okx = rows.find((r) => r.entry.wallet === KnownOrdinalWalletType.okx);
    expect(okx!.deepLink).toBeNull();
  });

  it('Mobile + INSTALLED Xverse → null (connects in-page, no in-app-browser bounce)', () => {
    const rows = buildInjectedPickerRows(
      WALLET_MATRIX, WalletPlatform.Mobile, new Set([KnownOrdinalWalletType.xverse]), undefined, TARGET_URL, walletInAppBrowserDeepLink,
    );
    const xverse = rows.find((r) => r.entry.wallet === KnownOrdinalWalletType.xverse);
    expect(xverse!.installed).toBe(true);
    expect(xverse!.deepLink).toBeNull();
  });
});

describe('buildInjectedPickerRows — action-scoping', () => {
  it('capability=Cat21OfferCreate drops Alby (Unsupported) — exact desktop offer set, matrix order', () => {
    // Positive-equality pin of the whole ordered set. Alby absent is a
    // consequence of this list, not a separate negative check.
    expect(rowTypes(WalletPlatform.Desktop, [], WalletCapability.Cat21OfferCreate)).toEqual([
      KnownOrdinalWalletType.cat21wallet,
      KnownOrdinalWalletType.xverse,
      KnownOrdinalWalletType.leather,
      KnownOrdinalWalletType.unisat,
      KnownOrdinalWalletType.wizz,
      KnownOrdinalWalletType.okx,
    ]);
  });

  it('no capability (header picker) keeps every desktop injected wallet, Alby included', () => {
    expect(rowTypes(WalletPlatform.Desktop)).toEqual([
      KnownOrdinalWalletType.cat21wallet,
      KnownOrdinalWalletType.xverse,
      KnownOrdinalWalletType.leather,
      KnownOrdinalWalletType.unisat,
      KnownOrdinalWalletType.wizz,
      KnownOrdinalWalletType.okx,
      KnownOrdinalWalletType.alby,
    ]);
  });

  it('capability=Cat21OfferAccept also drops Alby (Unsupported to accept)', () => {
    expect(rowTypes(WalletPlatform.Desktop, [], WalletCapability.Cat21OfferAccept))
      .not.toContain(KnownOrdinalWalletType.alby);
  });
});

describe('buildInjectedPickerRows — platform filter + injected-only + installed flag', () => {
  it('watch-only xpub never appears (injected rows only)', () => {
    expect(rowTypes(WalletPlatform.Desktop)).not.toContain(KnownOrdinalWalletType.xpub);
    expect(rowTypes(WalletPlatform.Mobile)).not.toContain(KnownOrdinalWalletType.xpub);
  });

  it('Mobile set = the matrix mobile-injected wallets (Leather desktop-only is absent)', () => {
    const mobile = rowTypes(WalletPlatform.Mobile);
    expect(mobile).toEqual([
      KnownOrdinalWalletType.xverse,
      KnownOrdinalWalletType.okx,
      KnownOrdinalWalletType.phantom,
      KnownOrdinalWalletType.binance,
    ]);
  });

  it('installed flag reflects the detected-provider set', () => {
    const rows = buildInjectedPickerRows(
      WALLET_MATRIX, WalletPlatform.Desktop, new Set([KnownOrdinalWalletType.leather]), undefined, TARGET_URL, walletInAppBrowserDeepLink,
    );
    expect(rows.find((r) => r.entry.wallet === KnownOrdinalWalletType.leather)!.installed).toBe(true);
    expect(rows.find((r) => r.entry.wallet === KnownOrdinalWalletType.xverse)!.installed).toBe(false);
  });
});

describe('actionCapabilityLineFor', () => {
  it('returns null without a capability (header picker omits the block)', () => {
    expect(actionCapabilityLineFor(KnownOrdinalWalletType.xverse, undefined)).toBeNull();
  });

  it('Xverse + Cat21OfferCreate → Proven line, exact shared-UX wording', () => {
    expect(actionCapabilityLineFor(KnownOrdinalWalletType.xverse, WalletCapability.Cat21OfferCreate)).toEqual({
      name: 'Sell (create an offer)',
      icon: '✓',
      wording: 'Verified end-to-end on our test network',
    });
  });

  it('Alby + Cat21OfferCreate → Unsupported line + matrix caveat', () => {
    const line = actionCapabilityLineFor(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate);
    expect(line!.name).toBe('Sell (create an offer)');
    expect(line!.icon).toBe('✕');
    expect(line!.wording).toContain('Not available with this wallet');
    expect(line!.wording).toContain('cannot create offers');
  });

  it('UniSat + Collections → Proven with the Taproot caveat appended', () => {
    const line = actionCapabilityLineFor(KnownOrdinalWalletType.unisat, WalletCapability.InscriptionParentChild);
    expect(line!.icon).toBe('✓');
    expect(line!.name).toBe('Collections (parent/child)');
    expect(line!.wording).toContain('Verified end-to-end on our test network');
    expect(line!.wording).toContain('Taproot');
  });
});

describe('capabilityLinesFor', () => {
  it('lists all seven capabilities in shared-UX order', () => {
    expect(capabilityLinesFor(KnownOrdinalWalletType.cat21wallet).map((l) => l.name)).toEqual([
      'Mint a cat',
      'Send a cat',
      'Sell (create an offer)',
      'Buy (accept an offer)',
      'Inscribe',
      'Collections (parent/child)',
      'Sign a message',
    ]);
  });

  it('reflects a wallet-level Unsupported capability (Alby sell) with the ✕ icon', () => {
    const sell = capabilityLinesFor(KnownOrdinalWalletType.alby).find((l) => l.name === 'Sell (create an offer)');
    expect(sell!.icon).toBe('✕');
    expect(sell!.wording).toContain('Not available with this wallet');
  });
});
