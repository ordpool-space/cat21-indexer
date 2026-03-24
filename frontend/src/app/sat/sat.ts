import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { OrdApiService } from '../shared/ord-api.service';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

@Component({
  selector: 'app-sat',
  templateUrl: './sat.html',
  imports: [RouterLink, CatGallery, DecimalPipe],
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
}
