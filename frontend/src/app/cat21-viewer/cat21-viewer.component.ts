import { DecimalPipe, NgStyle } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgbTooltip, NgbTooltipConfig } from '@ng-bootstrap/ng-bootstrap';

import { environment } from '../../environments/environment';
import { CatDto } from '../openapi-client';
import { CapitalizeFirstPipe } from './capitalize-first.pipe';
import { ShortenStringPipe } from './shorten-string.pipe';

@Component({
    selector: 'app-cat21-viewer',
    templateUrl: './cat21-viewer.component.html',
    styleUrls: ['./cat21-viewer.component.scss'],
    imports: [
    NgbTooltip,
    NgStyle,
    ShortenStringPipe,
    CapitalizeFirstPipe,
    DecimalPipe
],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class Cat21ViewerComponent {
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
