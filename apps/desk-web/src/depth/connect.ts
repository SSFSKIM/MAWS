// DC6's registrations into the shell (DX8): the depth column (`depth`) and a direct channel's unfolded working record
// (`transcript`), each loaded as a chunk of its own the first time it draws, so the desk's first load (and the phone,
// where neither is drawn) carries none of MAWS's transcript. Called once from `main.tsx`.
import { createElement, lazy, Suspense } from 'react';
import { registerSlot, type Slots } from '../shell/slots';

const LazyDepth = lazy(() => import('./view/DepthColumn'));
const LazyFold = lazy(() => import('./view/FoldTranscript'));

const Depth: Slots['depth'] = (props) => createElement(Suspense, { fallback: null }, createElement(LazyDepth, props));

// One fold's transcript per session and range: a new range is a new subscription and store key.
const Fold: Slots['transcript'] = (props) =>
  createElement(Suspense, { fallback: null }, createElement(LazyFold, { ...props, key: [props.session.machine, props.session.session, props.range.from, props.range.to].join('\u0000') }));

export function connectDepth(): () => void {
  const off = [registerSlot('depth', Depth), registerSlot('transcript', Fold)];
  return () => off.forEach((unregister) => unregister());
}
