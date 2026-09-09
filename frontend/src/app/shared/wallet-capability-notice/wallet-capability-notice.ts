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
      <div
        class="wallet-capability-notice"
        [class.is-precheck]="n.kind === 'precheck'"
        [attr.role]="n.kind === 'blocked' ? 'alert' : 'note'"
        data-testid="wallet-capability-notice">
        <p class="wcn-reason">{{ n.reason }}</p>
        @if (n.alternatives.length > 0) {
          <!-- Render the alternatives as a scannable list, never as prose and
               never truncated: the reader's question is "is the wallet I
               already have in here?", which a paragraph buries and a cap can't
               answer (round-2 §7). The reason + labels come verbatim from the
               SDK; we only lay them out. -->
          <p class="wcn-alt-heading">Wallets that can {{ n.actionPhrase }}:</p>
          <ul class="wcn-alt-list">
            @for (w of n.alternatives; track w) {
              <li>{{ w }}</li>
            }
          </ul>
        }
      </div>
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
    .wcn-reason { margin: 0; }
    .wcn-alt-heading { margin: 0.5rem 0 0.15rem; font-weight: bold; }
    // Scannable column of wallet names — one per line so the eye can find its own.
    .wcn-alt-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.15rem 0.75rem;
    }
    .wcn-alt-list li { white-space: nowrap; }
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
