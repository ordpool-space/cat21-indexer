import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { UtxoAssetDetail } from 'ordpool-sdk';

import { inscriptionReviewLink, runeEtchingReviewLink } from '../funding-asset-links';
import { rareSatLabel } from '../rare-sat-label';
import { RuneEtchingService } from '../rune-etching.service';

/**
 * The named assets on one funding coin, one line per kind: inscriptions and
 * cats linked to the transaction that created them, runes linked to their
 * etching once it resolves (plain text until then), the rare sat by its sat
 * number. Rendered inside the asset notice (the wallet proceeds) and the
 * expert-required warning (the wallet blocks) on mint, transfer and
 * make-offer, so the person reads the same identities in both places.
 *
 * The detail comes from the SDK's funding recommendation (`recommended.assets`),
 * never from a second scan of the coin.
 */
@Component({
  selector: 'app-funding-asset-list',
  templateUrl: './funding-asset-list.html',
  styleUrl: './funding-asset-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FundingAssetList {
  private runeEtching = inject(RuneEtchingService);

  readonly assets = input.required<UtxoAssetDetail>();

  /** `data-testid` prefix; each line's link or label is `<prefix>-inscription`, `-rune`, `-cat`, `-raresat`. */
  readonly testidPrefix = input.required<string>();

  readonly inscriptionReviewLink = inscriptionReviewLink;
  readonly rareSatLabel = rareSatLabel;

  constructor() {
    // Resolve the rune etchings when the list appears, not per render. The
    // service is idempotent and caches settled answers.
    effect(() => {
      const names = this.assets().runeNames;
      if (names.length > 0) {
        this.runeEtching.resolve(names);
      }
    });
  }

  /** Etching-tx link for a rune once its name has resolved, else null (plain text). */
  runeEtchingHref(name: string): string | null {
    const txid = this.runeEtching.etchings().get(name);
    return txid ? runeEtchingReviewLink(txid, name) : null;
  }
}
