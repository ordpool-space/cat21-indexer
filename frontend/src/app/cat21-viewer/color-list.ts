import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgbTooltip } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-color-list',
  template: `
    @for (color of colors(); track color; let l = $last) {
      <i class="colorBlock" [ngbTooltip]="color" [style.background-color]="color"></i>{{ color }}@if (!l) {<br>}
    }
  `,
  styleUrl: './color-list.scss',
  imports: [NgbTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ColorList {
  readonly colors = input<string[] | null | undefined>([]);
}
