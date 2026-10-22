// The depth column's registration into the shell (DX8's `depth` slot), loaded as a chunk of its own the first time it
// draws, so the desk's first load carries none of it, and the phone, where it is never drawn, never loads it. Called
// once from `main.tsx`. DC9 retired the `transcript` slot the folds unfolded: the center draws the session view.
import { createElement, lazy, Suspense } from 'react';
import { loadChunk } from '../pwa/load-chunk';
import { registerSlot, type Slots } from '../shell/slots';

const LazyDepth = lazy(() => loadChunk(() => import('./view/DepthColumn')));

const Depth: Slots['depth'] = (props) => createElement(Suspense, { fallback: null }, createElement(LazyDepth, props));

export function connectDepth(): () => void {
  return registerSlot('depth', Depth);
}
