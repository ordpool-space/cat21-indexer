import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { OrdApiService } from '../shared/ord-api.service';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

@Component({
  selector: 'app-address',
  templateUrl: './address.html',
  imports: [RouterLink, CatGallery],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Address {
  private readonly ordApi = inject(OrdApiService);
  readonly env = environment;

  readonly address = input.required<string>();

  addressResource = rxResourceFixed({
    params: () => ({ address: this.address() }),
    stream: ({ params }) => this.ordApi.getAddress(params.address),
  });

  catNumbers = computed(() => this.addressResource.value()?.cat_numbers ?? []);
}
