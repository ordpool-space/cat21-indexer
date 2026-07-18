import { ChangeDetectionStrategy, Component, computed, effect, inject, input, numberAttribute, signal, TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import {
  buildAskQueryParams,
  buildBuyOfferQueryParams,
  buildTransferQueryParams,
  WalletService,
} from 'ordpool-sdk';

import { Cat21Viewer } from '../cat21-viewer/cat21-viewer';
import { ApiService } from '../shared/cat21-api';
import { OrdApiService } from '../shared/ord-api.service';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

/**
 * Per-cat action button state.
 *
 * `enabled` = preconditions met, click will proceed.
 * `connect` = no wallet connected. Button rendered as disabled with a
 * "connect a wallet" tooltip so users discover the feature exists.
 * `not-owner` = wallet connected but not the current owner. Applies to
 * Sell and Send.
 * `owns-it` = wallet connected AND is the owner. Applies to Buy — you
 * can't buy a cat you already own.
 * `free` = cat is on an unspendable output (OP_RETURN, miner fee, or a
 * script that can never sign). No one can move it — sell, buy, and send
 * all become impossible actions rather than "for later" ones. Precedes
 * every other state; wins even before wallet-connect.
 * `unknown` = ord's owner lookup is loading OR errored, so we can't
 * decide isOwner honestly. Every action button downgrades to this
 * (not to `enabled` / `owns-it` / `not-owner`) rather than guess wrong.
 * A misclassified `enabled` for the actual owner meant they could
 * click "Buy" on their own cat when ord flaked. The unknown state
 * disables the button with an "owner lookup unavailable" tooltip.
 */
type ActionButtonState = 'enabled' | 'connect' | 'not-owner' | 'owns-it' | 'free' | 'unknown';

@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [RouterLink, Cat21Viewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown.ArrowLeft)': 'navigateNewer()',
    '(window:keydown.ArrowRight)': 'navigateOlder()',
  }
})
export class Details {
  private api = inject(ApiService);
  private ordApi = inject(OrdApiService);
  private router = inject(Router);
  private walletService = inject(WalletService);
  private modalService = inject(NgbModal);

  readonly catNumber = input(0, { transform: numberAttribute });

  /**
   * Query param `?ask=<sats>` — a seller's asking-price advertisement.
   * See workspace HQ "Offers can be shared in the wild".
   */
  readonly ask = input<string | undefined>(undefined);

  /**
   * Query param `?payTo=<address>` — the seller's PAYMENT address
   * from the sell modal. Forwarded to /dashboard/trade/make so the
   * buyer's make-offer form prefills the payment output destination.
   * NEVER derive this from the cat's on-chain owner (that's the
   * ordinals address; wrong context). See SDK HARD RULE "Never
   * derive a payment address from an on-chain lookup".
   */
  readonly payTo = input<string | undefined>(undefined);

  readonly askSats = computed<number | null>(() => {
    const raw = this.ask();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  });

  catResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.api.catsControllerGetCatByNumber(params.catNumber),
  });

  currentOwnerResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.ordApi.getCurrentOwner(params.catNumber),
  });

  currentOwnerState = computed(() => {
    if (this.currentOwnerResource.error()) return 'error' as const;
    if (this.currentOwnerResource.isLoading()) return 'loading' as const;
    const address = this.currentOwnerResource.value();
    if (address === undefined) return 'loading' as const;
    if (address === null) return 'free' as const;
    return 'address' as const;
  });

  statusResource = rxResourceFixed({
    stream: () => this.api.catsControllerGetStatus(),
  });

  lastSynced = computed(() => this.statusResource.value()?.lastSyncedCatNumber ?? 0);

  // ---------- Wallet + ownership ----------

  readonly connectedWallet = toSignal(this.walletService.connectedWallet$, { initialValue: null });

  /**
   * True when the connected wallet's ordinals address equals the cat's
   * current owner (resolved from ord). CAT-21 cats live on the ordinals
   * address per ordinal theory FIFO.
   */
  readonly isOwner = computed<boolean>(() => {
    const wallet = this.connectedWallet();
    const owner = this.currentOwnerResource.value();
    if (!wallet || !owner) return false;
    return wallet.ordinalsAddress === owner;
  });

  /**
   * True when ord reports the cat's sat is at an unspendable output —
   * OP_RETURN, miner fee, or any script that can never sign. The three
   * action buttons all downgrade to `free` in this state so the user
   * doesn't waste time trying to move a cat that structurally can't.
   */
  readonly isFree = computed<boolean>(() => this.currentOwnerState() === 'free');

  /** True when the owner lookup hasn't yielded a definitive answer
   *  yet — either still loading or errored. All three action buttons
   *  fall back to `unknown` in this state rather than guess. */
  readonly ownerLookupUnknown = computed<boolean>(() => {
    const state = this.currentOwnerState();
    return state === 'loading' || state === 'error';
  });

  readonly sellButtonState = computed<ActionButtonState>(() => {
    if (this.isFree()) return 'free';
    if (this.ownerLookupUnknown()) return 'unknown';
    if (!this.connectedWallet()) return 'connect';
    if (!this.isOwner()) return 'not-owner';
    return 'enabled';
  });

  readonly buyButtonState = computed<ActionButtonState>(() => {
    if (this.isFree()) return 'free';
    if (this.ownerLookupUnknown()) return 'unknown';
    if (!this.connectedWallet()) return 'connect';
    if (this.isOwner()) return 'owns-it';
    return 'enabled';
  });

  readonly sendButtonState = computed<ActionButtonState>(() => {
    if (this.isFree()) return 'free';
    if (this.ownerLookupUnknown()) return 'unknown';
    if (!this.connectedWallet()) return 'connect';
    if (!this.isOwner()) return 'not-owner';
    return 'enabled';
  });

  // ---------- Sell-listing modal ----------

  private sellModalTemplate = viewChild.required<TemplateRef<unknown>>('sellModal');
  private modalRef: NgbModalRef | undefined;

  /** Ask price the seller is entering in the modal (raw string input). */
  readonly askInput = signal<string>('');

  /**
   * Permalink derived from `askInput`; null until a valid positive
   * integer is entered. Encodes the seller's own PAYMENT address
   * (from the connected wallet) as `payTo=` so the buyer's make-offer
   * page never has to derive the seller's payment address from an
   * on-chain lookup — which would return the ORDINALS address for a
   * CAT-21 cat and cause `payment-output-wrong-address` validator
   * rejects on every split-address wallet. See the SDK HARD RULE
   * "Never derive a payment address from an on-chain lookup".
   */
  readonly generatedPermalink = computed<string | null>(() => {
    const raw = this.askInput().trim();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (typeof window === 'undefined') return null;
    const paymentAddress = this.connectedWallet()?.paymentAddress;
    // Sell button is gated on `enabled` (wallet connected + isOwner),
    // so paymentAddress should be present when the modal opens. If a
    // wallet-swap fires between open and copy, fall back to the ask-
    // only shape — the buyer's make-offer form then prompts them to
    // ask the seller for the address instead of a silent misroute.
    const query = new URLSearchParams(
      buildAskQueryParams(
        paymentAddress ? { askSats: n, sellerPaymentAddress: paymentAddress } : { askSats: n },
      ),
    ).toString();
    return `${window.location.origin}/cat/${this.catNumber()}?${query}`;
  });

  /** Just-clicked feedback for the copy button. */
  readonly copyStatus = signal<'idle' | 'copied'>('idle');

  constructor() {
    // Close the sell modal automatically when the wallet disconnects
    // or switches to a non-owner. Otherwise the modal would stay open
    // on a cat the user no longer owns.
    effect(() => {
      if (this.sellButtonState() !== 'enabled' && this.modalRef) {
        this.closeSellModal();
      }
    });
  }

  openSellModal(): void {
    if (this.sellButtonState() !== 'enabled') return;
    this.askInput.set('');
    this.copyStatus.set('idle');
    this.modalRef = this.modalService.open(this.sellModalTemplate(), {
      ariaLabelledBy: 'sell-listing-title',
      centered: true,
    });
  }

  closeSellModal(): void {
    this.modalRef?.close();
    this.modalRef = undefined;
  }

  onAskInputChange(value: string): void {
    this.askInput.set(value);
    this.copyStatus.set('idle');
  }

  onCopyPermalinkClick(): void {
    const url = this.generatedPermalink();
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => this.copyStatus.set('copied'),
      () => this.copyStatus.set('idle'),
    );
  }

  onShareOnXClick(): void {
    const url = this.generatedPermalink();
    if (!url) return;
    const text = `Cat #${this.catNumber()} for sale on cat21.space`;
    const share = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    if (typeof window !== 'undefined') {
      window.open(share, '_blank', 'noopener,noreferrer');
    }
  }

  /** Query params for `/dashboard/trade/make`. Delegated to the SDK's
   *  `buildBuyOfferQueryParams` and exposed as a computed signal so the
   *  RouterLink binding memoises across change-detection cycles. */
  readonly buyQueryParams = computed<Record<string, string>>(() => {
    const ask = this.askSats();
    const payTo = this.payTo();
    // Forward whatever ask + payTo the URL brought. `payTo` MUST come
    // from the URL — the SDK HARD RULE forbids deriving it from any
    // on-chain lookup. If the ask link was minted without it (legacy),
    // make-offer's form asks the buyer to fill it manually.
    const args: Parameters<typeof buildBuyOfferQueryParams>[0] = { catNumber: this.catNumber() };
    if (ask !== null) args.askSats = ask;
    if (payTo) args.sellerPaymentAddress = payTo;
    return buildBuyOfferQueryParams(args);
  });

  /** Query params for `/dashboard/transfer`. */
  readonly sendQueryParams = computed<Record<string, string>>(() =>
    buildTransferQueryParams({ catNumber: this.catNumber() }),
  );

  navigateNewer() {
    const n = this.catNumber();
    if (n < this.lastSynced()) {
      this.router.navigate(['/cat', n + 1]);
    }
  }

  navigateOlder() {
    const n = this.catNumber();
    if (n > 0) {
      this.router.navigate(['/cat', n - 1]);
    }
  }
}
