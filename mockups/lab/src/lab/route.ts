import { useEffect, useState } from 'react';
import type { SceneId, Scheme } from './types';

export interface Route {
  exp: string | null;
  scene: SceneId;
  scheme: Scheme;
  knobs: Record<string, string>;
  /** `bare=1` hides the lab's own switcher, for a clean look or a capture. */
  bare: boolean;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const [exp, scene] = path.split('/');
  const q = new URLSearchParams(query);
  const knobs: Record<string, string> = {};
  q.forEach((v, k) => {
    if (k !== 'scheme' && k !== 'bare') knobs[k] = v;
  });
  return {
    exp: exp || null,
    scene: (scene as SceneId) || 'session',
    scheme: q.get('scheme') === 'dark' ? 'dark' : 'light',
    knobs,
    bare: q.get('bare') === '1',
  };
}

export function href(r: Partial<Route> & { exp: string | null }): string {
  if (!r.exp) return '#/';
  const q = new URLSearchParams();
  if (r.scheme === 'dark') q.set('scheme', 'dark');
  for (const [k, v] of Object.entries(r.knobs ?? {})) q.set(k, v);
  if (r.bare) q.set('bare', '1');
  const s = q.toString();
  return `#/${r.exp}/${r.scene ?? 'session'}${s ? `?${s}` : ''}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
