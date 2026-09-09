import { WalletPlatform, detectWalletPlatform } from 'ordpool-sdk';

/**
 * cat21.space relies on the SDK's DEVICE-based platform detection to decide
 * which wallets its picker offers and whether the "Open in <wallet>" bounce
 * applies (round-2 §7.9: platform is a fact about the device, never the
 * viewport width). This repoints the coverage that used to live on a local
 * copy onto the shipped `detectWalletPlatform(win)` the site actually calls,
 * so the user-visible fact (a phone gets mobile wallets, a desktop dragged
 * narrow still gets desktop wallets) stays pinned.
 */
function win(userAgent: string, maxTouchPoints = 0): Parameters<typeof detectWalletPlatform>[0] {
  return { navigator: { userAgent, maxTouchPoints } } as unknown as Parameters<typeof detectWalletPlatform>[0];
}

describe('detectWalletPlatform (the SDK device detection cat21.space depends on)', () => {
  it('reads a phone user agent as Mobile', () => {
    expect(detectWalletPlatform(win('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'))).toBe(WalletPlatform.Mobile);
    expect(detectWalletPlatform(win('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'))).toBe(WalletPlatform.Mobile);
  });

  it('reads a desktop user agent as Desktop', () => {
    expect(detectWalletPlatform(win('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'))).toBe(WalletPlatform.Desktop);
  });

  it('separates an iPadOS Macintosh UA (touch points) from a real Mac (none)', () => {
    expect(detectWalletPlatform(win('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5))).toBe(WalletPlatform.Mobile);
    expect(detectWalletPlatform(win('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0))).toBe(WalletPlatform.Desktop);
  });

  it('answers Desktop for an unknown / SSR environment (offers more wallets, not fewer)', () => {
    expect(detectWalletPlatform(undefined)).toBe(WalletPlatform.Desktop);
    expect(detectWalletPlatform(win(''))).toBe(WalletPlatform.Desktop);
  });
});
