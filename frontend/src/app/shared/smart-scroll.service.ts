import { Injectable, inject } from '@angular/core';
import { Router, Scroll } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { filter } from 'rxjs';

/**
 * Smart scroll service: scrolls to top on forward navigation,
 * restores position on back/forward browser navigation.
 *
 * Replaces Angular's built-in scrollPositionRestoration which
 * scrolls to top on every navigation (including pagination).
 */
@Injectable({ providedIn: 'root' })
export class SmartScrollService {
  #router = inject(Router);
  #viewportScroller = inject(ViewportScroller);

  constructor() {
    this.#router.events.pipe(
      filter((e): e is Scroll => e instanceof Scroll)
    ).subscribe(event => {
      if (event.position) {
        // Back/forward: restore saved position
        this.#viewportScroller.scrollToPosition(event.position);
      } else if (event.anchor) {
        // Anchor link
        this.#viewportScroller.scrollToAnchor(event.anchor);
      } else {
        // Forward navigation: scroll to top
        this.#viewportScroller.scrollToPosition([0, 0]);
      }
    });
  }
}
