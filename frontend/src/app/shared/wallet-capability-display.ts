import {
  CapabilitySupport,
  KnownOrdinalWallets,
  KnownOrdinalWalletType,
  WalletCapability,
} from 'ordpool-sdk';

/**
 * Presentation layer for the SDK wallet capability matrix.
 *
 * This file holds ONLY the user-facing wording that the shared-UX spec
 * (`ordpool-sdk/docs/wallet-picker-ux-shared.md`) mandates be identical
 * across cat21.space, ordpool.space, and cubes: the support-level
 * wording, the capability display names, and the signing-mode line. The
 * facts (who supports what, caveats, notes) come from the SDK matrix and
 * are never duplicated here — only how a support level or capability id
 * renders as text.
 *
 * Keep the strings byte-identical to the shared-UX tables; a change here
 * is a cross-site contract change and belongs in the SDK doc first.
 */

/** Status glyph per support level (shared-UX "Icon" column). */
export function supportIcon(support: CapabilitySupport): string {
  switch (support) {
    case CapabilitySupport.Proven:
      return '✓';
    case CapabilitySupport.Adapter:
      return '○';
    case CapabilitySupport.Unsupported:
      return '✕';
    default: {
      // Exhaustiveness guard: if the SDK widens CapabilitySupport, this
      // fails to compile (never assignment) AND throws at runtime instead
      // of returning undefined into the icon column.
      const unhandled: never = support;
      throw new Error(`Unhandled CapabilitySupport: ${String(unhandled)}`);
    }
  }
}

/**
 * Base wording for a support level, per the shared-UX "Support-level
 * wording" table. NO trailing period (it's a label) and NO caveat: the
 * matrix `caveat` is rendered as its OWN element beside this wording, the
 * cross-site canonical structure (ordpool + cubes + cat21.space) agreed
 * in the 2026-08-28 sync — a separate field is punctuation-safe and can't
 * double-punctuate a caveat that already ends in a period.
 */
export function supportWording(support: CapabilitySupport): string {
  switch (support) {
    case CapabilitySupport.Proven:
      return 'Verified end-to-end on our test network';
    case CapabilitySupport.Adapter:
      return 'Supported, not yet verified end-to-end';
    case CapabilitySupport.Unsupported:
      return 'Not available with this wallet';
    default: {
      // Exhaustiveness guard: a widened CapabilitySupport fails to compile
      // here AND throws at runtime rather than returning undefined into
      // `capabilityLine` (which would crash on the spread).
      const unhandled: never = support;
      throw new Error(`Unhandled CapabilitySupport: ${String(unhandled)}`);
    }
  }
}

/** Display name per capability, per the shared-UX "Capability display names" table. */
export function capabilityDisplayName(capability: WalletCapability): string {
  switch (capability) {
    case WalletCapability.Cat21Mint:
      return 'Mint a cat';
    case WalletCapability.Cat21Transfer:
      return 'Send a cat';
    case WalletCapability.Cat21OfferCreate:
      return 'Sell (create an offer)';
    case WalletCapability.Cat21OfferAccept:
      return 'Buy (accept an offer)';
    case WalletCapability.Inscription:
      return 'Inscribe';
    case WalletCapability.InscriptionParentChild:
      return 'Collections (parent/child)';
    case WalletCapability.SignMessage:
      return 'Sign a message';
  }
}

/** Signing-mode line, per the shared-UX info-icon "Header" wording. */
export function signingModeWording(signingMode: 'injected' | 'watch-only'): string {
  // The external-wallet example list is sourced from the SDK matrix
  // (`KnownOrdinalWallets[xpub].subLabel`) — single source of truth,
  // agreed cross-session so the three sites can't drift. Only the
  // sentence frame is local UI copy. `subLabel` is optional in the SDK
  // type, so drop the parenthetical entirely when it is absent rather
  // than printing "(undefined)".
  if (signingMode === 'injected') {
    return 'Signs in your browser';
  }
  const examples = KnownOrdinalWallets[KnownOrdinalWalletType.xpub].subLabel;
  return examples
    ? `You sign in your own wallet (${examples})`
    : 'You sign in your own wallet';
}

/**
 * The seven capabilities in the order they should be listed in the info
 * popover's "Everything this wallet can do here" section. Matches the
 * shared-UX display-name table order.
 */
export const CAPABILITY_DISPLAY_ORDER: readonly WalletCapability[] = [
  WalletCapability.Cat21Mint,
  WalletCapability.Cat21Transfer,
  WalletCapability.Cat21OfferCreate,
  WalletCapability.Cat21OfferAccept,
  WalletCapability.Inscription,
  WalletCapability.InscriptionParentChild,
  WalletCapability.SignMessage,
];
