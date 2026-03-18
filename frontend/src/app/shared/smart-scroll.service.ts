import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router, Scroll } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { filter, pairwise } from 'rxjs';

/**
 * Smart scroll service: scrolls to top on route changes,
 * but NOT on param-only changes (e.g., pagination).
 * Restores position on back/forward browser navigation.
 */
@Injectable({ providedIn: 'root' })
export class SmartScrollService {
  #router = inject(Router);
  #viewportScroller = inject(ViewportScroller);

  constructor() {
    this.#router.events.pipe(
      filter((e): e is Scroll => e instanceof Scroll),
      pairwise(),
    ).subscribe(([prev, curr]) => {
      if (curr.position) {
        // Back/forward: restore saved position
        this.#viewportScroller.scrollToPosition(curr.position);
      } else if (curr.anchor) {
        // Anchor link
        this.#viewportScroller.scrollToAnchor(curr.anchor);
      } else {
        // Forward navigation: only scroll to top if route path changed
        const prevRoute = this.#routePath((prev.routerEvent as NavigationEnd).urlAfterRedirects);
        const currRoute = this.#routePath((curr.routerEvent as NavigationEnd).urlAfterRedirects);
        if (currRoute !== prevRoute) {
          this.#viewportScroller.scrollToPosition([0, 0]);
        }
      }
    });
  }

  /** Extract the first path segment (route) ignoring params */
  #routePath(url: string): string {
    const segments = url.split('/').filter(Boolean);
    return segments[0] ?? '';
  }
}
