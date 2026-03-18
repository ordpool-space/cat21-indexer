import { Injectable, inject, afterEveryRender, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, Scroll } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { filter } from 'rxjs';

/**
 * Smart scroll service for anchor links and back/forward navigation.
 *
 * ## Problem
 * Markdown renders `<a href="#section">` links. The browser scrolls
 * IMMEDIATELY on click, before Angular's Scroll event fires.
 * So we can't capture the "before" position at event time.
 *
 * ## Solution
 * Track scroll positions continuously. When anchor event fires,
 * use the PREVIOUS position (before browser's native scroll).
 *
 * ## Async Content
 * Blog content loads via HTTP. Element might not exist yet.
 * `afterEveryRender` retries until element exists or page is tall enough.
 */
@Injectable({ providedIn: 'root' })
export class SmartScrollService {
  #router = inject(Router);
  #viewportScroller = inject(ViewportScroller);
  #platformId = inject(PLATFORM_ID);

  #pendingAnchor: string | null = null;
  #pendingPosition: [number, number] | null = null;

  /** Continuously tracked: position before the most recent scroll */
  #previousScrollPosition: [number, number] = [0, 0];
  #currentScrollPosition: [number, number] = [0, 0];

  /** Position to restore on BACK from anchor */
  #positionBeforeAnchor: [number, number] | null = null;
  #previousComponent: unknown = undefined;

  constructor() {
    if (isPlatformBrowser(this.#platformId)) {
      window.addEventListener('scroll', () => {
        this.#previousScrollPosition = this.#currentScrollPosition;
        this.#currentScrollPosition = this.#viewportScroller.getScrollPosition() as [number, number];
      }, { passive: true });
    }

    this.#router.events.pipe(
      filter((e): e is Scroll => e instanceof Scroll)
    ).subscribe(event => {
      if (event.anchor) {
        // Anchor click: use position from BEFORE browser scrolled
        this.#positionBeforeAnchor = this.#previousScrollPosition;
        this.#pendingAnchor = event.anchor;
      } else if (this.#positionBeforeAnchor) {
        // BACK from anchor: restore saved position
        this.#pendingPosition = this.#positionBeforeAnchor;
        this.#positionBeforeAnchor = null;
      } else if (event.position) {
        // BACK/FORWARD: use Angular's stored position
        this.#pendingPosition = event.position;
      } else {
        // Forward navigation: scroll to top only if component changed
        const curr = this.#activeComponent();
        const changed = this.#previousComponent !== undefined && curr !== this.#previousComponent;
        this.#previousComponent = curr;
        if (changed) {
          this.#viewportScroller.scrollToPosition([0, 0]);
        }
        return;
      }
      this.#previousComponent = this.#activeComponent();
      this.#tryScroll();
    });

    // Retry for async content
    afterEveryRender(() => this.#tryScroll());
  }

  #activeComponent(): unknown {
    let route = this.#router.routerState.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route.component;
  }

  #tryScroll(): void {
    if (this.#pendingAnchor) {
      const el = document.getElementById(this.#pendingAnchor);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        this.#pendingAnchor = null;
      }
    }

    if (this.#pendingPosition) {
      this.#viewportScroller.scrollToPosition(this.#pendingPosition);
      const actual = this.#viewportScroller.getScrollPosition();
      if (Math.abs(actual[1] - this.#pendingPosition[1]) <= 10) {
        this.#pendingPosition = null;
      }
    }
  }
}
