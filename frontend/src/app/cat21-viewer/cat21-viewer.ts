import { DatePipe, DecimalPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgbTooltip, NgbTooltipConfig } from '@ng-bootstrap/ng-bootstrap';
import { formatSatsWithUsd } from 'ordpool-sdk';

import { environment } from '../../environments/environment';
import { catImageLoader } from '../shared/cat-image-loader';
import { CatDto } from '../shared/cat21-api';
import { CapitalizeFirst } from './capitalize-first';
import { ColorList } from './color-list';
import { ShortenString } from '../shared/shorten-string';

@Component({
  selector: 'app-cat21-viewer',
  templateUrl: './cat21-viewer.html',
  styleUrl: './cat21-viewer.scss',
  imports: [
    NgbTooltip,
    NgOptimizedImage,
    RouterLink,
    ShortenString,
    CapitalizeFirst,
    ColorList,
    DecimalPipe,
    DatePipe
  ],
  providers: [catImageLoader],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21Viewer {
  readonly cat = input<CatDto | undefined>(undefined);
  readonly showDetails = input(false);
  readonly currentOwner = input<string | null | undefined>(undefined);
  readonly currentOwnerState = input<'loading' | 'address' | 'free' | 'error'>('loading');
  /** Current BTC/USD, or null when unavailable (then the USD suffix is hidden). */
  readonly btcUsd = input<number | null>(null);
  readonly env = environment;

  /**
   * The mint price: the whole amount the minter converted into this cat, in
   * sats, with a current-USD equivalent. That is the cat UTXO's own value (the
   * sats that now live on the cat) PLUS the fee paid to mine the mint tx: the
   * net liquid sats that left the minter's wallet (funding minus change). Fee
   * alone understates it; the value is locked on the cat, so it is part of what
   * the cat cost. The sats are the stable record; the USD floats with today's
   * price.
   */
  readonly mintPrice = computed(() => {
    const cat = this.cat();
    return cat ? formatSatsWithUsd(cat.value + cat.fee, this.btcUsd()) : '';
  });

  /**
   * The Mint Price row shows for every cat EXCEPT the Genesis Cat (#0). Cat #0
   * carries a static lore Price of 21 BTC; showing its mint fee beside that
   * would read as a second, contradictory price on the one cat whose price is
   * fixed by the lore. Every other cat has no lore price, so the mint fee is
   * the only price it has.
   */
  readonly showMintPrice = computed(() => {
    const cat = this.cat();
    return !!cat && cat.catNumber !== 0;
  });

  constructor() {
    inject(NgbTooltipConfig).animation = false;
  }

  readonly ngSrc = computed(() => {
    const cat = this.cat();
    if (!cat) return null;
    const format = this.showDetails() ? 'svg' : 'webp';
    return `cat/${cat.catNumber}/image.${format}`;
  });

  // Empty-string fallback covers the rare cat row with neither value
  // (some legacy fixtures); 'Unknown' would lie about parser output.
  readonly gender = computed(() => this.cat()?.gender || '—');
}
