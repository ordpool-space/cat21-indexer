import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { Cat21Service, PendingMint } from 'ordpool-sdk';

/**
 * Lists CAT-21 mints currently sitting in the mempool addressed to
 * one of the supplied wallet addresses. Used in:
 *   - the wallet popover (passes [ordinalsAddress, paymentAddress])
 *   - /dashboard/cats above the confirmed-cats gallery (passes
 *     [ordinalsAddress])
 *
 * Subscribes to the SDK's polled feed for as long as this component
 * is mounted with at least one address; unmount or empty-array input
 * stops the polling chain.
 */
@Component({
  selector: 'app-pending-cats',
  templateUrl: './pending-cats.html',
  styleUrl: './pending-cats.scss',
  imports: [DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingCats {
  private cat21 = inject(Cat21Service);

  readonly addresses = input<string[]>([]);

  /** Header text the consumer can override (default fits the wallet-popover voice). */
  readonly heading = input<string>('Your pending cats');

  /** Where on cat21.space a mint's txid links. ordpool.space owns the tx-detail page. */
  readonly txLinkBase = 'https://ordpool.space/tx/';

  // toObservable bridges the addresses input signal to an observable
  // stream; switchMap stops the previous polling chain and starts a
  // fresh one whenever the address set changes (e.g. when the user
  // disconnects + reconnects with a different wallet — that's the
  // semantic the user explicitly called out).
  readonly pendingMints = toSignal(
    toObservable(this.addresses).pipe(
      switchMap((addresses) =>
        addresses.length === 0 ? of([] as PendingMint[]) : this.cat21.pendingMints$(addresses),
      ),
    ),
    { initialValue: [] as PendingMint[] },
  );

  /**
   * Short txid for display: first 4 + … + last 4.
   */
  shortTxid(txid: string): string {
    if (!txid || txid.length < 12) return txid;
    return `${txid.slice(0, 4)}…${txid.slice(-4)}`;
  }
}
