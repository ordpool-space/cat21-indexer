import {
  CapabilitySupport,
  KnownOrdinalWalletType,
  WalletCapability,
  WalletMatrixEntry,
  WalletPlatform,
  capabilityOf,
} from 'ordpool-sdk';

import {
  CAPABILITY_DISPLAY_ORDER,
  capabilityDisplayName,
  supportIcon,
  supportWording,
} from '../wallet-capability-display';

/**
 * Pure view-model layer for the wallet picker: turns the SDK capability
 * matrix into the rows + popover lines the `WalletConnect` component
 * renders. Extracting it keeps the component thin and lets the picker
 * logic — platform filter, action-scoping, deep-link resolution, and the
 * "what this action needs" line — be unit-tested against the real SDK
 * matrix without a component harness. Mirrors cubes'
 * `wallet-picker-rows.ts` so the three consumer sites stay structurally
 * aligned.
 *
 * Wallet FACTS come from the matrix; only the shared-UX wording (sourced
 * from `wallet-capability-display.ts`) is applied here.
 */

/** One capability line in the info popover (icon + display name + wording). */
export interface CapabilityLine {
  name: string;
  icon: string;
  wording: string;
}

/**
 * One injected-wallet row in the connect picker: a matrix entry reachable
 * on the current platform, tagged installed/not (runtime detection) and
 * carrying its mobile in-app-browser deep link when one applies.
 */
export interface WalletPickerRow {
  entry: WalletMatrixEntry;
  installed: boolean;
  /**
   * The wallet's in-app-browser deep link, for a NOT-installed wallet on
   * Mobile that has a docs-verified scheme (Xverse today). Null otherwise
   * (installed, desktop, or no verified scheme) — the row stays Download.
   */
  deepLink: string | null;
}

/**
 * Build the injected-wallet picker rows for one platform.
 *
 * - platform filter: only matrix entries reachable on `platform`.
 * - injected only: watch-only (xpub) is a separate paste-flow row, never here.
 * - action-scoping: when `capability` is set (an action card), drop the
 *   wallets the matrix marks `Unsupported` for it (shared-UX §1 — no Alby
 *   in a buy/sell dialog). `undefined` keeps every platform-reachable
 *   wallet (the global header picker).
 * - deep link: resolved per not-installed row on Mobile via
 *   `resolveDeepLink` (the SDK's `walletInAppBrowserDeepLink`); null on
 *   Desktop, when installed, or when the wallet has no verified scheme.
 *
 * @param entries the SDK matrix (`WALLET_MATRIX`).
 * @param platform Desktop / Mobile (runtime-detected by the consumer).
 * @param installedTypes wallet types whose provider is detected right now.
 * @param capability the action the picker connects a wallet for, or undefined.
 * @param targetUrl the page URL to bounce into the wallet's in-app browser.
 * @param resolveDeepLink the SDK deep-link registry lookup.
 */
export function buildInjectedPickerRows(
  entries: readonly WalletMatrixEntry[],
  platform: WalletPlatform,
  installedTypes: ReadonlySet<KnownOrdinalWalletType>,
  capability: WalletCapability | undefined,
  targetUrl: string,
  resolveDeepLink: (wallet: KnownOrdinalWalletType, targetUrl: string) => string | null,
): WalletPickerRow[] {
  return entries
    .filter((e) => e.signingMode === 'injected' && e.platforms.includes(platform))
    .filter((e) => capability === undefined || capabilityOf(e.wallet, capability).support !== CapabilitySupport.Unsupported)
    .map((entry) => {
      const installed = installedTypes.has(entry.wallet);
      const deepLink = !installed && platform === WalletPlatform.Mobile
        ? resolveDeepLink(entry.wallet, targetUrl)
        : null;
      return { entry, installed, deepLink };
    });
}

/**
 * The "What this action needs" popover line (shared-UX §2 item 2): the
 * page action's capability and this wallet's status for it. Null when the
 * picker is not action-scoped (the header picker), so the block is omitted.
 */
export function actionCapabilityLineFor(
  wallet: KnownOrdinalWalletType,
  capability: WalletCapability | undefined,
): CapabilityLine | null {
  if (capability === undefined) return null;
  const status = capabilityOf(wallet, capability);
  return {
    name: capabilityDisplayName(capability),
    icon: supportIcon(status.support),
    wording: supportWording(status),
  };
}

/** All seven capabilities for a wallet, in display order, with icon + wording. */
export function capabilityLinesFor(wallet: KnownOrdinalWalletType): CapabilityLine[] {
  return CAPABILITY_DISPLAY_ORDER.map((cap) => {
    const status = capabilityOf(wallet, cap);
    return {
      name: capabilityDisplayName(cap),
      icon: supportIcon(status.support),
      wording: supportWording(status),
    };
  });
}
