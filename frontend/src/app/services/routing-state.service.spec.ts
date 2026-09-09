import { NavigationEnd, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { RoutingStateService } from './routing-state.service';

function makeRouter(deepestData: Record<string, unknown>) {
  const events = new Subject<unknown>();
  // root -> child (the deepest, firstChild null) carrying the route data
  const root = {
    firstChild: { firstChild: null, snapshot: { data: deepestData } },
    snapshot: { data: {} },
  };
  return { events, routerState: { root } };
}

function setup(router: unknown): RoutingStateService {
  TestBed.configureTestingModule({
    providers: [RoutingStateService, { provide: Router, useValue: router }],
  });
  return TestBed.inject(RoutingStateService);
}

describe('RoutingStateService.smallHeader', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('starts false and becomes true when the deepest activated route has smallHeader data', () => {
    const router = makeRouter({ smallHeader: true });
    const service = setup(router);

    expect(service.smallHeader()).toBe(false); // initialValue before any navigation
    router.events.next(new NavigationEnd(1, '/cat/0', '/cat/0'));
    expect(service.smallHeader()).toBe(true);
  });

  it('stays false when the deepest route has no smallHeader flag', () => {
    const router = makeRouter({});
    const service = setup(router);
    router.events.next(new NavigationEnd(1, '/', '/'));
    expect(service.smallHeader()).toBe(false);
  });
});
