import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  CapabilitySupport,
  KnownOrdinalWalletType,
  WalletCapability,
  WalletPlatform,
  capabilityOf,
  walletMatrixEntry,
  walletsSupporting,
} from 'ordpool-sdk';

import { detectWalletPlatform } from '../wallet-platform';

/**
 * Inline notice for a CONNECTED wallet that cannot perform the current
 * action (per the SDK matrix). Renders nothing when the wallet supports
 * the action; when it does not, it explains why (matrix `caveat`) and
 * names the wallets that can, per the shared-UX spec's disabled-action
 * rule. Never hides the action — the host disables the button and shows
 * this alongside it.
 *
 * `Proven`-with-caveat statuses (e.g. UniSat/Wizz collections needing a
 * Taproot active address) are NOT a block: this component treats them as
 * supported and stays silent, leaving the actionable pre-check to the
 * host. Only `Unsupported` produces a notice.
 */
@Component({
  selector: 'app-wallet-capability-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (blocked(); as b) {
      <p class="wallet-capability-notice" role="note" data-testid="wallet-capability-notice">
        <strong>{{ b.walletLabel }} can't do this:</strong> {{ b.reason }}.
        {{ b.alternatives }}
      </p>
    }
  `,
  styles: [`
    .wallet-capability-notice {
      border: 2px solid #dc3545;
      background: #f8d7da;
      color: #842029;
      padding: 0.5rem 0.75rem;
      margin: 0.75rem 0;
      font-size: 0.85rem;
      line-height: 1.35;
    }
  `],
})
export class WalletCapabilityNotice {
  readonly wallet = input.required<KnownOrdinalWalletType>();
  readonly capability = input.required<WalletCapability>();

  /**
   * Non-null only when the connected wallet is `Unsupported` for the
   * action. Carries the wallet label, the matrix reason, and a
   * comma-listed set of wallets that CAN do it on this platform.
   */
  readonly blocked = computed<{ walletLabel: string; reason: string; alternatives: string } | null>(() => {
    const status = capabilityOf(this.wallet(), this.capability());
    if (status.support !== CapabilitySupport.Unsupported) return null;

    const walletLabel = walletMatrixEntry(this.wallet())?.label ?? 'This wallet';
    const reason = status.caveat ?? 'this wallet cannot perform this action';

    const others = walletsSupporting(this.capability(), { platform: detectWalletPlatform() })
      .filter((e) => e.wallet !== this.wallet());
    const injected = others.filter((e) => e.signingMode === 'injected').map((e) => e.label);
    const hasWatchOnly = others.some((e) => e.wallet === KnownOrdinalWalletType.xpub);

    let alternatives = '';
    if (injected.length > 0) {
      alternatives = `Connect ${listWithOr(injected)}`;
      alternatives += hasWatchOnly ? ', or use the watch-only path.' : '.';
    } else if (hasWatchOnly) {
      alternatives = 'Use the watch-only path.';
    }
    return { walletLabel, reason, alternatives };
  });
}

/** "A, B, or C" — Oxford-style list for the alternatives sentence. */
function listWithOr(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/** The two trade actions this notice guards, re-exported for host convenience. */
export const OFFER_CREATE_CAPABILITY = WalletCapability.Cat21OfferCreate;
export const OFFER_ACCEPT_CAPABILITY = WalletCapability.Cat21OfferAccept;
