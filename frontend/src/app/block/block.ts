import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, numberAttribute } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../environments/environment';
import { CatGallery } from '../cat-gallery/cat-gallery';
import { OrdApiService } from '../shared/ord-api.service';
import { rxResourceFixed } from '../shared/rx-resource-fixed';

@Component({
  selector: 'app-block',
  templateUrl: './block.html',
  imports: [RouterLink, CatGallery, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:keydown.ArrowLeft)': 'navigatePrev()',
    '(window:keydown.ArrowRight)': 'navigateNext()',
  },
})
export class Block {
  private readonly ordApi = inject(OrdApiService);
  private readonly router = inject(Router);
  readonly env = environment;

  readonly blockHeight = input(0, { transform: numberAttribute });
  readonly page = input(0, { transform: numberAttribute });

  blockResource = rxResourceFixed({
    params: () => ({ blockHeight: this.blockHeight(), page: this.page() }),
    stream: ({ params }) => this.ordApi.getBlock(params.blockHeight, params.page),
  });

  catNumbers = computed(() => this.blockResource.value()?.cat_numbers ?? []);
  hasMore = computed(() => this.blockResource.value()?.more ?? false);
  currentPage = computed(() => this.blockResource.value()?.page_index ?? 0);

  navigatePrev() {
    if (this.currentPage() > 0) {
      this.router.navigate(['/block', this.blockHeight(), this.currentPage() - 1]);
    }
  }

  navigateNext() {
    if (this.hasMore()) {
      this.router.navigate(['/block', this.blockHeight(), this.currentPage() + 1]);
    }
  }
}
