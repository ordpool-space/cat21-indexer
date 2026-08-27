import {
  CapabilitySupport,
  WalletCapability,
  WalletCapabilityStatus,
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
  }
}

/**
 * User-facing sentence for a capability's status, per the shared-UX
 * "Support-level wording" table. The base wording carries NO trailing
 * period (it's a label, matching the shared-UX table and the ordpool /
 * cubes sister sites). A `Proven`/`Unsupported` status with a matrix
 * `caveat` follows the base wording with the caveat as its own sentence
 * (separated by a period, keeping its own punctuation); `Adapter` never
 * carries a caveat in the matrix.
 */
export function supportWording(status: WalletCapabilityStatus): string {
  const caveat = status.caveat ? ` ${capitalizeSentence(status.caveat)}.` : '';
  const sep = status.caveat ? '.' : '';
  switch (status.support) {
    case CapabilitySupport.Proven:
      return `Verified end-to-end on our test network${sep}${caveat}`;
    case CapabilitySupport.Adapter:
      return `Supported, not yet verified end-to-end${sep}${caveat}`;
    case CapabilitySupport.Unsupported:
      return `Not available with this wallet${sep}${caveat}`;
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
  return signingMode === 'injected'
    ? 'Signs in your browser'
    : 'You sign in your own wallet (Sparrow, Coldcard, Ledger, ...)';
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

/** Uppercase the first letter of a matrix caveat so it reads as a sentence. */
function capitalizeSentence(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
