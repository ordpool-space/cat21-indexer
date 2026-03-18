import { DecimalPipe, NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgbTooltip, NgbTooltipConfig } from '@ng-bootstrap/ng-bootstrap';

import { CatDto } from '../openapi-client';
import { catImageLoader } from '../shared/cat-image-loader';
import { environment } from '../../environments/environment';
import { CapitalizeFirst } from './capitalize-first';
import { ColorList } from './color-list';
import { ShortenString } from './shorten-string';

@Component({
    selector: 'app-cat21-viewer',
    templateUrl: './cat21-viewer.html',
    styleUrl: './cat21-viewer.scss',
    imports: [
    NgbTooltip,
    NgOptimizedImage,
    ShortenString,
    CapitalizeFirst,
    ColorList,
    DecimalPipe
],
    providers: [catImageLoader],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21Viewer {
  readonly cat = input<CatDto | undefined>(undefined);
  readonly showDetails = input(false);
  readonly env = environment;

  constructor() {
    inject(NgbTooltipConfig).animation = false;
  }

  readonly ngSrc = computed(() => {
    const cat = this.cat();
    if (!cat) return null;
    const format = this.showDetails() ? 'svg' : 'webp';
    return `cat/${cat.catNumber}/image.${format}`;
  });

  readonly gender = computed(() => {
    const cat = this.cat();
    if (!cat) return '';
    if (cat.male) return 'Male';
    if (cat.female) return 'Female';
    return 'Unknown';
  });
}
