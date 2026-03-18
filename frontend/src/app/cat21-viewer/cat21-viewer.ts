import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgbTooltip, NgbTooltipConfig } from '@ng-bootstrap/ng-bootstrap';

import { environment } from '../../environments/environment';
import { CatDto } from '../openapi-client';
import { CapitalizeFirst } from './capitalize-first';
import { ShortenString } from './shorten-string';

@Component({
    selector: 'app-cat21-viewer',
    templateUrl: './cat21-viewer.html',
    styleUrl: './cat21-viewer.scss',
    imports: [
    NgbTooltip,
    ShortenString,
    CapitalizeFirst,
    DecimalPipe
],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21Viewer {
  readonly cat = input<CatDto | undefined>(undefined);
  readonly showDetails = input(false);

  constructor(tooltipConfig: NgbTooltipConfig) {
    tooltipConfig.animation = false;
  }

  readonly imageUrl = computed(() => {
    const cat = this.cat();
    if (!cat) return null;
    const format = this.showDetails() ? 'svg' : 'gif';
    return `${environment.api}/api/cat/${cat.catNumber}/image.${format}`;
  });

  readonly gender = computed(() => {
    const cat = this.cat();
    if (!cat) return '';
    if (cat.male) return 'Male';
    if (cat.female) return 'Female';
    return 'Unknown';
  });
}
