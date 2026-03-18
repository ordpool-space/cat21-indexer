import { IMAGE_LOADER, ImageLoaderConfig } from '@angular/common';
import { environment } from '../../environments/environment';

/**
 * Custom image loader for cat images served from our backend.
 * Maps ngSrc values like "cat/0/image.webp" to full API URLs.
 */
export const catImageLoader = {
  provide: IMAGE_LOADER,
  useValue: (config: ImageLoaderConfig) => `${environment.api}/api/${config.src}`,
};
