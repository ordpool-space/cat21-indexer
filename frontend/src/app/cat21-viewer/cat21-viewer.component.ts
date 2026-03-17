import { DecimalPipe, NgFor, NgIf, NgStyle } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
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
    NgIf,
    NgFor,
    NgbTooltip,
    NgStyle,
    ShortenStringPipe,
    CapitalizeFirstPipe,
    DecimalPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class Cat21ViewerComponent {
  @Input() cat: CatDto | undefined = undefined;
  @Input() showDetails = false;

  constructor(tooltipConfig: NgbTooltipConfig) {
    tooltipConfig.animation = false;
  }

  get imageUrl(): string | null {
    if (!this.cat) return null;
    const format = this.showDetails ? 'svg' : 'gif';
    return `${environment.api}/api/cat/${this.cat.catNumber}/image.${format}`;
  }

  get gender(): string {
    if (!this.cat) return '';
    if (this.cat.male) return 'Male';
    if (this.cat.female) return 'Female';
    return 'Unknown';
  }
}
