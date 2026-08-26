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

/**
 * Deep-link that reopens the given URL inside a wallet's own in-app
 * browser, for the "mobile, plain browser, no injected provider" case.
 * Returns `null` for wallets whose scheme we have not verified (the
 * picker then omits the deep-link affordance for that wallet rather than
 * sending the user to a guessed URL).
 *
 * Only Xverse's scheme is wired: it is the one given verbatim in the
 * cat21.space handover doc. OKX and Binance ship their own dApp-browser
 * entry points but the exact URL shapes are not yet verified against
 * their developer docs — they stay `null` until confirmed (never guess a
 * scheme; a wrong deep-link is a dead end for the user).
 */
export function walletInAppBrowserDeepLink(wallet: string, targetUrl: string): string | null {
  if (wallet === 'xverse') {
    return `https://connect.xverse.app/browser?url=${encodeURIComponent(targetUrl)}`;
  }
  return null;
}
