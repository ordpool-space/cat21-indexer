import { CapabilitySupport, WalletCapability } from 'ordpool-sdk';

import {
  CAPABILITY_DISPLAY_ORDER,
  capabilityDisplayName,
  signingModeWording,
  supportIcon,
  supportWording,
} from './wallet-capability-display';

// These assertions pin the shared-UX wording tables
// (ordpool-sdk/docs/wallet-picker-ux-shared.md). The strings are a
// cross-site contract: cat21.space, ordpool.space, and cubes must render
// identical text. A failure here means the wording drifted from the spec.

describe('wallet-capability-display', () => {

  describe('supportIcon', () => {
    it('maps each support level to its shared-UX glyph', () => {
      expect(supportIcon(CapabilitySupport.Proven)).toBe('✓');
      expect(supportIcon(CapabilitySupport.Adapter)).toBe('○');
      expect(supportIcon(CapabilitySupport.Unsupported)).toBe('✕');
    });
  });

  describe('supportWording', () => {
    it('Proven without caveat carries no trailing period (shared-UX label)', () => {
      expect(supportWording({ support: CapabilitySupport.Proven }))
        .toBe('Verified end-to-end on our test network');
    });

    it('Proven with caveat appends the capitalized caveat sentence', () => {
      expect(supportWording({
        support: CapabilitySupport.Proven,
        caveat: 'requires the wallet\'s active address type to be Taproot (P2TR)',
      })).toBe('Verified end-to-end on our test network. Requires the wallet\'s active address type to be Taproot (P2TR).');
    });

    it('Adapter never carries a caveat and has no trailing period', () => {
      expect(supportWording({ support: CapabilitySupport.Adapter }))
        .toBe('Supported, not yet verified end-to-end');
    });

    it('Unsupported with caveat appends the reason', () => {
      expect(supportWording({
        support: CapabilitySupport.Unsupported,
        caveat: 'Alby WebBTC signPsbt signs EVERY input with one Taproot key',
      })).toBe('Not available with this wallet. Alby WebBTC signPsbt signs EVERY input with one Taproot key.');
    });

    it('Unsupported without caveat carries no trailing period (shared-UX label)', () => {
      expect(supportWording({ support: CapabilitySupport.Unsupported }))
        .toBe('Not available with this wallet');
    });
  });

  describe('capabilityDisplayName', () => {
    it('maps every capability to its shared-UX display name', () => {
      expect(capabilityDisplayName(WalletCapability.Cat21Mint)).toBe('Mint a cat');
      expect(capabilityDisplayName(WalletCapability.Cat21Transfer)).toBe('Send a cat');
      expect(capabilityDisplayName(WalletCapability.Cat21OfferCreate)).toBe('Sell (create an offer)');
      expect(capabilityDisplayName(WalletCapability.Cat21OfferAccept)).toBe('Buy (accept an offer)');
      expect(capabilityDisplayName(WalletCapability.Inscription)).toBe('Inscribe');
      expect(capabilityDisplayName(WalletCapability.InscriptionParentChild)).toBe('Collections (parent/child)');
      expect(capabilityDisplayName(WalletCapability.SignMessage)).toBe('Sign a message');
    });
  });

  describe('signingModeWording', () => {
    it('injected vs watch-only', () => {
      expect(signingModeWording('injected')).toBe('Signs in your browser');
      expect(signingModeWording('watch-only'))
        .toBe('You sign in your own wallet (Sparrow, Coldcard, Ledger, ...)');
    });
  });

  describe('CAPABILITY_DISPLAY_ORDER', () => {
    it('lists all seven capabilities in the shared-UX order', () => {
      expect(CAPABILITY_DISPLAY_ORDER).toEqual([
        WalletCapability.Cat21Mint,
        WalletCapability.Cat21Transfer,
        WalletCapability.Cat21OfferCreate,
        WalletCapability.Cat21OfferAccept,
        WalletCapability.Inscription,
        WalletCapability.InscriptionParentChild,
        WalletCapability.SignMessage,
      ]);
    });
  });
});
