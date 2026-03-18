import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  templateUrl: './header.html',
  styleUrl: './header.scss',
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'header',
  imports: [RouterLink, NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Header {
  readonly smallHeader = input<boolean | null>(false);
}
