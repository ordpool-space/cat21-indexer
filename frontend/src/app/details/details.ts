import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, numberAttribute, signal, TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { EMPTY } from 'rxjs';
import {
  buildAskQueryParams,
  buildBuyOfferQueryParams,
  buildTransferQueryParams,
  CatOutpoint,
  WalletService,
} from 'ordpool-sdk';

import { Cat21Viewer } from '../cat21-viewer/cat21-viewer';
import { ApiService } from '../shared/cat21-api';
import { Cat21BidsService, PersistedCat21Bid } from '../shared/cat21-bids.service';
import { Cat21ListingService, CreateListingError, PersistedCat21Listing } from '../shared/cat21-listing.service';
import { CatUtxoLookupService } from '../shared/cat-utxo-lookup.service';
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
 * `stale` = URL brought a `catTxid`/`catVout` intent from an ask
 * link, but the cat's current on-chain outpoint doesn't match. The
 * cat has moved since the link was created — the seller may have
 * already sold it to someone else. Only the Buy button downgrades
 * (Sell/Send are the current owner's actions, evaluated against
 * live ownership; a stale URL doesn't invalidate them).
 */
type ActionButtonState = 'enabled' | 'connect' | 'not-owner' | 'owns-it' | 'free' | 'unknown' | 'stale';

@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [DatePipe, RouterLink, Cat21Viewer],
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
  private catUtxoLookup = inject(CatUtxoLookupService);
  private listingService = inject(Cat21ListingService);
  private bidsService = inject(Cat21BidsService);

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

  /**
   * Query params `?catTxid=<64hex>&catVout=<n>` — the cat UTXO
   * outpoint the seller's link was minted against. Forms the
   * seller's INTENT lock: if the URL brings these AND the cat's
   * current on-chain outpoint doesn't match, the cat has moved
   * since the link was created (someone else already bought/
   * transferred it) → the offer is void, Buy button downgrades to
   * `stale`. Legacy links without these params skip the check.
   */
  readonly catTxid = input<string | undefined>(undefined);
  readonly catVout = input<string | undefined>(undefined);

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

  /**
   * Active orderbook listing for THIS cat, if any. Fetches from the
   * cat21-indexer backend's GET /api/v1/listings/cat/:catNumber. The
   * backend returns null (404) when there's no active listing —
   * getListingForCat swallows that as `null` here, so the template
   * just uses `activeListing()` truthy-check to render the badge.
   *
   * The stale check is server-side (the pruner drops moved cats
   * hourly), so if a row is present, it's cryptographically signed
   * for the CURRENT outpoint within the pruner's freshness window.
   */
  listingResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.listingService.getListingForCat(params.catNumber),
  });

  readonly activeListing = computed<PersistedCat21Listing | null>(() => this.listingResource.value() ?? null);

  /**
   * All active bids on the cat's CURRENT UTXO. Only fetched once the
   * current outpoint has resolved (bids are keyed on outpoint, not
   * cat number — a bid on cat #42 lives on whichever UTXO cat #42
   * lives on RIGHT NOW). Returns [] when the outpoint hasn't
   * resolved yet, when no bids exist, or on error (fail-quiet so a
   * bids-service outage doesn't break the details page).
   */
  bidsResource = rxResourceFixed({
    params: () => {
      const target = this.currentTargetResource.value()?.target;
      if (!target) return null as unknown as { txid: string; vout: number };
      return { txid: target.txid, vout: target.vout };
    },
    stream: ({ params }) => {
      if (!params) return EMPTY;
      return this.bidsService.getBidsForOutpoint(params.txid, params.vout);
    },
  });

  readonly activeBids = computed<PersistedCat21Bid[]>(() => this.bidsResource.value() ?? []);
  readonly hasBids = computed<boolean>(() => this.activeBids().length > 0);
  readonly highestBidSats = computed<number | null>(() => {
    const bids = this.activeBids();
    if (bids.length === 0) return null;
    // Bids come sorted DESC by price already, but be defensive.
    return Math.max(...bids.map((b) => b.bidSats));
  });

  /**
   * Query params for the "Buy" button on the active-listing badge.
   * Threads through everything the seller signed so make-offer's
   * stale-detection can compare against the cat's current outpoint
   * — a listing might have been pruned in the ~hour window between
   * the seller's sign and the buyer's click.
   */
  readonly listingBuyQueryParams = computed<Record<string, string>>(() => {
    const listing = this.activeListing();
    if (!listing) return {};
    return buildBuyOfferQueryParams({
      catNumber: listing.catNumber,
      askSats: listing.askSats,
      sellerPaymentAddress: listing.payTo,
      catOutpoint: { txid: listing.catTxid, vout: listing.catVout },
    });
  });

  currentOwnerResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) => this.ordApi.getCurrentOwner(params.catNumber),
  });

  /**
   * The cat's CURRENT on-chain outpoint (txid + vout). Used for two
   * purposes:
   *   1. Detecting stale ask links (compare against `linkedOutpoint()`
   *      from the URL).
   *   2. Pinning the seller's intent when THIS user opens the sell
   *      modal — the outpoint at modal-open time gets baked into
   *      `generatedPermalink()` so the shared link is self-invalidating
   *      once the cat moves.
   *
   * Uses the same lookup path (indexer → ord → esplora cross-check)
   * as make-offer's target resolution — one source of truth for
   * "where does this cat live right now".
   */
  currentTargetResource = rxResourceFixed({
    params: () => ({ catNumber: this.catNumber() }),
    stream: ({ params }) =>
      // Guard against negative / NaN early — the router transform can
      // still emit 0 before the URL is real.
      Number.isFinite(params.catNumber) && params.catNumber >= 0
        ? this.catUtxoLookup.getTargetByNumber(params.catNumber)
        : EMPTY,
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

  /**
   * Cat outpoint the URL was minted against (from `?catTxid=…&catVout=…`).
   * Null when either param is missing / malformed — legacy ask links
   * carry no intent-lock and get no stale check.
   */
  readonly linkedOutpoint = computed<CatOutpoint | null>(() => {
    const txid = this.catTxid();
    const voutRaw = this.catVout();
    if (!txid || !voutRaw) return null;
    if (!/^[0-9a-f]{64}$/i.test(txid)) return null;
    const vout = Number.parseInt(voutRaw, 10);
    if (!Number.isInteger(vout) || vout < 0) return null;
    return { txid: txid.toLowerCase(), vout };
  });

  /**
   * True when the URL brought an intent-lock (`linkedOutpoint`) AND the
   * cat's current on-chain outpoint doesn't match — the cat has moved
   * since the link was created. Buy button downgrades to `stale`; Sell
   * and Send still evaluate against live ownership (the OWNER can act
   * on their own cat regardless of what stale URL they landed on).
   * Returns false while the current-outpoint lookup is still loading
   * (would misfire as stale before the truth is known).
   */
  readonly isStaleOffer = computed<boolean>(() => {
    const linked = this.linkedOutpoint();
    if (!linked) return false;
    const target = this.currentTargetResource.value();
    if (!target) return false;
    return target.target.txid !== linked.txid || target.target.vout !== linked.vout;
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
    // Stale check runs AFTER we know the cat is spendable and its
    // owner has been resolved, so `stale` is a distinct terminal
    // state — the button never oscillates back to `enabled` once
    // the URL's intent-lock is confirmed invalid.
    if (this.isStaleOffer()) return 'stale';
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
    // Include the cat's current outpoint if we've resolved it — pins
    // the seller's intent to a specific UTXO. If the cat moves after
    // the link is shared, the buyer's page detects the mismatch and
    // refuses to build a PSBT (see SDK `AskQueryArgs.catOutpoint`).
    const currentTarget = this.currentTargetResource.value()?.target;
    const args: Parameters<typeof buildAskQueryParams>[0] = { askSats: n };
    if (paymentAddress) args.sellerPaymentAddress = paymentAddress;
    if (currentTarget) args.catOutpoint = { txid: currentTarget.txid, vout: currentTarget.vout };
    const query = new URLSearchParams(buildAskQueryParams(args)).toString();
    return `${window.location.origin}/cat/${this.catNumber()}?${query}`;
  });

  /** Just-clicked feedback for the copy button. */
  readonly copyStatus = signal<'idle' | 'copied'>('idle');

  // ---------- Orderbook publish ----------

  /**
   * Pre-checked: the seller opts INTO the orderbook by default (the
   * whole point is to be discoverable). Unchecking means "just give
   * me a shareable link, don't publish anywhere public".
   */
  readonly publishToOrderbook = signal<boolean>(true);

  /**
   * State machine for the "list on orderbook" flow:
   *   - `idle` — checkbox may be on or off; nothing has been posted.
   *   - `signing` — wallet's signature-prompt is open.
   *   - `posting` — signature back, HTTP POST in flight.
   *   - `success` — listing accepted; row is live.
   *   - `error` — one of the CreateListingErrorCode reasons; see
   *               `orderbookError()` for the code + human message.
   */
  readonly orderbookState = signal<'idle' | 'signing' | 'posting' | 'success' | 'error'>('idle');
  readonly orderbookError = signal<CreateListingError | null>(null);

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
    // Always copy the URL — an offline "just share this link" workflow
    // still needs to work even if the checkbox is off.
    navigator.clipboard?.writeText(url).then(
      () => this.copyStatus.set('copied'),
      () => this.copyStatus.set('idle'),
    );
    // Additionally publish to the orderbook if opted in. Sequential so
    // a wallet rejection during signing doesn't clobber the copied-URL
    // feedback the user already got.
    if (this.publishToOrderbook()) {
      this.publishListing();
    }
  }

  /**
   * Toggle handler for the "list on orderbook" checkbox. Persists
   * signal state; also clears any prior error so the UI doesn't show
   * a stale rejection after the seller unchecks + re-checks.
   */
  onPublishToOrderbookToggle(value: boolean): void {
    this.publishToOrderbook.set(value);
    if (!value) {
      this.orderbookState.set('idle');
      this.orderbookError.set(null);
    }
  }

  /**
   * Publish the current ask to the CAT-21 orderbook via the SDK's
   * BIP-322 signing flow + backend POST. Requires a wallet with a
   * signMessage-capable signer (cat21-wallet, Xverse, Leather,
   * Unisat, OKX today) and the cat's current outpoint from the
   * lookup resource — if either is missing the state stays idle
   * with a descriptive error.
   */
  private publishListing(): void {
    const ask = this.askInput().trim();
    const askSats = Number.parseInt(ask, 10);
    if (!Number.isFinite(askSats) || askSats <= 0) return;
    const target = this.currentTargetResource.value()?.target;
    if (!target) {
      this.orderbookState.set('error');
      this.orderbookError.set({
        code: 'network-error',
        detail: 'Cat outpoint not yet resolved. Try again in a moment.',
      });
      return;
    }
    this.orderbookState.set('signing');
    this.orderbookError.set(null);
    // Fetch the live cats-on-utxo snapshot before signing so the
    // seller commits to the whole bundle (v3 message shape). If the
    // /output call fails, surface as `ord-lookup-failed` — same code
    // the backend uses for its own drift check.
    this.ordApi.getCatsAtOutput(target.txid, target.vout).subscribe({
      next: (cats) => {
        if (!cats.includes(this.catNumber())) {
          this.orderbookState.set('error');
          this.orderbookError.set({
            code: 'cats-bundle-drift',
            detail:
              `Cat #${this.catNumber()} is no longer on this UTXO — ord reports ` +
              `[${cats.join(',')}]. The cat may have moved; refresh and re-list.`,
          });
          return;
        }
        this.listingService
          .publishListing({
            catNumber: this.catNumber(),
            cats,
            askSats,
            catTxid: target.txid,
            catVout: target.vout,
          })
          .subscribe({
            next: () => {
              this.orderbookState.set('success');
            },
            error: (err: CreateListingError) => {
              this.orderbookState.set('error');
              this.orderbookError.set(err);
            },
          });
      },
      error: (err) => {
        this.orderbookState.set('error');
        this.orderbookError.set({
          code: 'ord-lookup-failed',
          detail: `Couldn't fetch cats on this UTXO: ${err instanceof Error ? err.message : String(err)}`,
        });
      },
    });
    // Transition signing → posting happens implicitly when signMessage
    // resolves and the POST fires. We could poll for that, but the
    // signMessage RPC is opaque; the UI shows "signing…" until the
    // whole thing completes. Good enough for MVP.
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
    const linked = this.linkedOutpoint();
    // Forward whatever ask + payTo + catOutpoint the URL brought.
    // `payTo` MUST come from the URL — the SDK HARD RULE forbids
    // deriving it from any on-chain lookup. `catOutpoint` also
    // stays URL-sourced (never derived from current state) so the
    // make-offer page sees the SAME intent-lock the seller minted
    // — otherwise a stale link forwarded through this page would
    // silently upgrade to a fresh outpoint and the intent-lock
    // would be defeated.
    const args: Parameters<typeof buildBuyOfferQueryParams>[0] = { catNumber: this.catNumber() };
    if (ask !== null) args.askSats = ask;
    if (payTo) args.sellerPaymentAddress = payTo;
    if (linked) args.catOutpoint = linked;
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
