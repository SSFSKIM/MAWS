// @vitest-environment happy-dom
// DX8's routes and the cards' (P5 O13 M5, §E): `/cards` the list, `/cards/<ref>/<session>` a session's cards, each
// component percent-encoded as a notification's landing encodes it, and a path read back as the route it was made from.
import { describe, expect, it } from 'vitest';
import { parseRoute, routePath, type Route } from './layout';

describe('the routes', () => {
  it('reads and writes the cards list and a session’s cards', () => {
    expect(parseRoute('/cards')).toEqual({ view: 'cards' });
    expect(parseRoute('/cards/')).toEqual({ view: 'cards' });
    expect(parseRoute('/cards/ref-1/app-1')).toEqual({ view: 'cards', machine: 'ref-1', session: 'app-1' });
    expect(parseRoute('/cards/a%2Fb_c-d/s%20e')).toEqual({ view: 'cards', machine: 'a/b_c-d', session: 's e' });
    expect(parseRoute('/cards/ref-only')).toEqual({ view: 'cards' });
    const routes: Route[] = [{ view: 'cards' }, { view: 'cards', machine: 'a/b c', session: 'x/y' }, { view: 'grid' }, { view: 'org' }, { view: 'project', project: 'p', channel: { kind: 'session', session: 's' } }];
    for (const route of routes) expect(parseRoute(routePath(route))).toEqual(route);
    expect(routePath({ view: 'cards', machine: 'ref-1', session: 'app-1' })).toBe('/cards/ref-1/app-1');
  });
});
