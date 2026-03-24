import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';

import { catImageLoader } from '../shared/cat-image-loader';

@Component({
  selector: 'app-cat-gallery',
  templateUrl: './cat-gallery.html',
  styleUrl: './cat-gallery.scss',
  imports: [NgOptimizedImage, RouterLink],
  providers: [catImageLoader],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatGallery {
  readonly catNumbers = input.required<number[]>();
  readonly emptyMessage = input('No cats found.');
}
