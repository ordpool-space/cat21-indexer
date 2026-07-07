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
 */
type ActionButtonState = 'enabled' | 'connect' | 'not-owner' | 'owns-it';

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
   * The parameter is minimal on purpose: no seller address, no
   * signature — the buy flow resolves the current owner from ord at
   * click time. See workspace HQ "Offers can be shared in the wild".
   */
  readonly ask = input<string | undefined>(undefined);

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

  readonly sellButtonState = computed<ActionButtonState>(() => {
    if (!this.connectedWallet()) return 'connect';
    if (!this.isOwner()) return 'not-owner';
    return 'enabled';
  });

  readonly buyButtonState = computed<ActionButtonState>(() => {
    if (!this.connectedWallet()) return 'connect';
    if (this.isOwner()) return 'owns-it';
    return 'enabled';
  });

  readonly sendButtonState = computed<ActionButtonState>(() => {
    if (!this.connectedWallet()) return 'connect';
    if (!this.isOwner()) return 'not-owner';
    return 'enabled';
  });

  // ---------- Sell-listing modal ----------

  private sellModalTemplate = viewChild.required<TemplateRef<unknown>>('sellModal');
  private modalRef: NgbModalRef | undefined;

  /** Ask price the seller is entering in the modal (raw string input). */
  readonly askInput = signal<string>('');

  /** Permalink derived from `askInput`; null until a valid positive integer is entered. */
  readonly generatedPermalink = computed<string | null>(() => {
    const raw = this.askInput().trim();
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (typeof window === 'undefined') return null;
    const query = new URLSearchParams(buildAskQueryParams({ askSats: n })).toString();
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
    return buildBuyOfferQueryParams(
      ask !== null
        ? { catNumber: this.catNumber(), askSats: ask }
        : { catNumber: this.catNumber() },
    );
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
