// DC6's one registration into the shell (DX8): the depth column, loaded as a chunk of its own the first time it draws a
// session, so the desk's first load (and the phone, where depth is not drawn) carries none of MAWS's transcript.
// Called once from `main.tsx`.
import { createElement, lazy, Suspense } from 'react';
import { registerSlot, type Slots } from '../shell/slots';

const LazyDepth = lazy(() => import('./view/DepthColumn'));

const Depth: Slots['depth'] = (props) => createElement(Suspense, { fallback: null }, createElement(LazyDepth, props));

export function connectDepth(): () => void {
  return registerSlot('depth', Depth);
}
