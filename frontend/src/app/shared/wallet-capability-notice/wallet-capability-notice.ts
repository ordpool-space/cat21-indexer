import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  KnownOrdinalWalletType,
  WalletActionNotice,
  WalletCapability,
  detectWalletPlatform,
  walletActionNotice,
} from 'ordpool-sdk';

/**
 * Inline notice for a CONNECTED wallet on an action page. The SDK's
 * `walletActionNotice()` composes the whole second-person sentence (the
 * reason plus the live list of wallets that can do it, computed from the
 * matrix at call time); we print it verbatim, never appending or rewording
 * it (round-2 §7.4). Two kinds:
 *
 *   - `blocked`  — the wallet cannot do it. The host disables the action
 *                  button; this shows a red notice.
 *   - `precheck` — it can, once the user changes something (e.g. switch to a
 *                  Taproot address). The host keeps the button enabled; this
 *                  shows a milder notice.
 *
 * Null when the wallet can do the action — renders nothing.
 */
@Component({
  selector: 'app-wallet-capability-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notice(); as n) {
      <p
        class="wallet-capability-notice"
        [class.is-precheck]="n.kind === 'precheck'"
        [attr.role]="n.kind === 'blocked' ? 'alert' : 'note'"
        data-testid="wallet-capability-notice">
        {{ n.message }}
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
    // A precheck is not an error — it is a step the user can take. Amber, not red.
    .wallet-capability-notice.is-precheck {
      border-color: #b58105;
      background: #fff3cd;
      color: #664d03;
    }
  `],
})
export class WalletCapabilityNotice {
  readonly wallet = input.required<KnownOrdinalWalletType>();
  readonly capability = input.required<WalletCapability>();

  /**
   * The SDK-composed action notice for the connected wallet, or null when
   * the wallet can perform the action. Printed verbatim; the site never
   * assembles the sentence (round-2 §7.4).
   */
  readonly notice = computed<WalletActionNotice | null>(() =>
    walletActionNotice(this.wallet(), this.capability(), {
      platform: detectWalletPlatform(typeof window !== 'undefined' ? window : undefined),
    }),
  );
}
