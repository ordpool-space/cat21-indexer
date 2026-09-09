import { WalletPlatform } from 'ordpool-sdk';

import { detectWalletPlatform } from './wallet-platform';

function setUA(ua: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

describe('detectWalletPlatform', () => {
  const originalUA = navigator.userAgent;
  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
  });

  it('detects a phone UA as Mobile', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    expect(detectWalletPlatform()).toBe(WalletPlatform.Mobile);
  });

  it('detects an Android UA as Mobile', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile');
    expect(detectWalletPlatform()).toBe(WalletPlatform.Mobile);
  });

  it('detects a desktop UA as Desktop', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120');
    expect(detectWalletPlatform()).toBe(WalletPlatform.Desktop);
  });

  it('treats an iPadOS Macintosh UA with touch points as Mobile', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15', 5);
    expect(detectWalletPlatform()).toBe(WalletPlatform.Mobile);
  });

  it('treats a real Mac (Macintosh UA, no touch) as Desktop', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15', 0);
    expect(detectWalletPlatform()).toBe(WalletPlatform.Desktop);
  });
});
