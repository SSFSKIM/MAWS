// P5 O16 M3b fix wave 3: where a completion goes, by the process that raised its request, with no host lifecycle: two
// processes' links side by side (a draining host and a ready successor, as an app-side operation can outlive its host
// while the successor raises its own), each completion to its own raiser, and a gone raiser's late completion refused
// while the other's still routes.
import { describe, expect, it } from 'vitest';
import { CompletionRoutes } from './completion-routes';

const link = (name: string) => ({ name });

describe('completion routes', () => {
  it('a draining host and a ready successor: each completion reaches its own raiser; a gone raiser’s is refused, the other’s still routes', () => {
    const routes = new CompletionRoutes<{ name: string }>();
    const draining = link('draining');
    const successor = link('successor');
    routes.opened(draining, 100);
    routes.opened(successor, 200);
    routes.raised('req-old', draining);
    routes.raised('req-new', successor);
    const served = [successor, draining];
    expect(routes.route('req-old', served)).toEqual({ link: draining, pid: 100 });
    expect(routes.route('req-new', served)).toEqual({ link: successor, pid: 200 });

    expect(routes.closed(draining)).toBe(100);
    routes.gone(100);
    expect(routes.route('req-old', [successor])).toBeNull();
    expect(routes.route('req-new', [successor])).toEqual({ link: successor, pid: 200 });
  });

  it('held for its raiser while it reconnects, on the fresh link once it is back; gone once another process is welcomed', () => {
    const routes = new CompletionRoutes<{ name: string }>();
    const first = link('first');
    routes.opened(first, 100);
    routes.raised('req-1', first);
    routes.closed(first); // a recycle, a quiet loss
    expect(routes.route('req-1', [])).toEqual({ hold: 100 });
    const fresh = link('fresh');
    expect(routes.opened(fresh, 100)).toEqual([]);
    expect(routes.route('req-1', [fresh])).toEqual({ link: fresh, pid: 100 });

    routes.closed(fresh);
    expect(routes.opened(link('other'), 300)).toEqual([100]); // one process serves the lock: 100 is gone
    expect(routes.route('req-1', [])).toBeNull();
  });

  it('a request never seen raised: the first open link preferred, else held for a reconnecting process, else refused', () => {
    const routes = new CompletionRoutes<{ name: string }>();
    const served = link('served');
    routes.opened(served, 100);
    expect(routes.route('unknown', [null, served])).toEqual({ link: served, pid: 100 });
    routes.closed(served);
    expect(routes.route('unknown', [null])).toEqual({ hold: 100 });
    routes.gone(100);
    expect(routes.route('unknown', [null])).toBeNull();
  });
});
