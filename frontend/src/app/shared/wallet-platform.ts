import { WalletPlatform } from 'ordpool-sdk';

/**
 * Runtime platform detection for the wallet picker.
 *
 * The SDK matrix says which wallets are reachable on `Desktop` vs
 * `Mobile` (see `WalletPlatform`); detecting which one the current
 * visitor is on is the consumer's job (per the cat21.space handover).
 *
 * `Mobile` here means "a phone/tablet browser" — the environment where
 * the only way to reach an injected wallet provider is inside a wallet's
 * own in-app dApp browser. A desktop extension is never present there.
 */
export function detectWalletPlatform(): WalletPlatform {
  // SSR / non-browser: default to Desktop (the richer picker); the
  // client re-evaluates on hydration.
  if (typeof navigator === 'undefined') return WalletPlatform.Desktop;

  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua)) {
    return WalletPlatform.Mobile;
  }
  // iPadOS 13+ reports a Macintosh UA but is a touch device; a real Mac
  // reports maxTouchPoints 0/1.
  if (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    return WalletPlatform.Mobile;
  }
  return WalletPlatform.Desktop;
}

// The in-app-browser deep-link helper now lives in the SDK
// (`walletInAppBrowserDeepLink` from 'ordpool-sdk'), so the verified
// scheme list is curated in one place across all consumers. Import it
// directly where the mobile-plain-browser affordance is built.
