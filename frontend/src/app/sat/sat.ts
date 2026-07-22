import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { OrdApiService } from '../shared/ord-api.service';
import { rxResourceFixed } from '../shared/rx-resource-fixed';
import { SafeResourceUrlPipe } from '../shared/safe-resource-url';
import { ShortenString } from '../shared/shorten-string';

@Component({
  selector: 'app-sat',
  templateUrl: './sat.html',
  styleUrl: './sat.scss',
  imports: [RouterLink, CatGallery, DecimalPipe, ShortenString, SafeResourceUrlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sat {
  private readonly ordApi = inject(OrdApiService);
  readonly env = environment;

  readonly sat = input(0, { transform: numberAttribute });

  satResource = rxResourceFixed({
    params: () => ({ sat: this.sat() }),
    stream: ({ params }) => this.ordApi.getSat(params.sat),
  });

  catNumbers = computed(() => this.satResource.value()?.cat_numbers ?? []);

  /** txid portion of the sat's satpoint (`txid:vout:offset`), for the tx cross-link. */
  readonly satpointTxid = computed(() => this.satResource.value()?.satpoint?.split(':')[0] ?? null);

  /**
   * Regular inscriptions on this sat, from the full ord instance. Kept
   * separate from satResource (which reads cats from the cat-only ord) so
   * that if the full instance is unreachable the cats still render and the
   * inscriptions section simply stays hidden.
   */
  inscriptionsResource = rxResourceFixed({
    params: () => ({ sat: this.sat() }),
    stream: ({ params }) => this.ordApi.getSatInscriptions(params.sat),
  });

  /** Sandboxed-iframe src for an inscription preview on the full ord instance. */
  previewUrl(inscriptionId: string): string {
    return `${this.env.ordFullExplorer}/preview/${inscriptionId}`;
  }
}
