import { IMAGE_LOADER } from '@angular/common';

import { environment } from '../../environments/environment';

import { catImageLoader } from './cat-image-loader';

describe('catImageLoader', () => {
  const loader = catImageLoader.useValue as (c: { src: string }) => string;

  it('maps an ngSrc path to the backend /api/ URL', () => {
    expect(loader({ src: 'cat/0/image.webp' })).toBe(`${environment.api}/api/cat/0/image.webp`);
  });

  it('is wired to the IMAGE_LOADER token', () => {
    expect(catImageLoader.provide).toBe(IMAGE_LOADER);
  });
});
