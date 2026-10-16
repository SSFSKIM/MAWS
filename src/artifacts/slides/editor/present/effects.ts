// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D13; M6): the show's motion as Web Animations keyframes:
// each build effect in (and, reversed, out), and the slide transitions. Builds move an element by the individual
// `translate` and `scale` properties, which compose with the dialect's own `transform` (a turned element stays turned).
// Portable (§4.10): plain keyframe data, and a guard for a DOM without `animate` (the unit tests' happy-dom).
import type { BuildEffect } from './sequence';

export const BUILD_MS = 500;
export const TRANSITION_MS = 600;
export const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.45, 0, 0.2, 1)';

const NONE = { opacity: 1, translate: '0px 0px', scale: '1' };

/** An effect's keyframes as an element builds in; an element building out plays them reversed. */
export function buildKeyframes(effect: BuildEffect): Keyframe[] {
  switch (effect) {
    case 'fade':
      return [{ opacity: 0 }, { opacity: 1 }];
    case 'rise':
      return [{ opacity: 0, translate: '0px 80px' }, NONE];
    case 'drop':
      return [{ opacity: 0, translate: '0px -80px' }, NONE];
    case 'left':
      return [{ opacity: 0, translate: '-160px 0px' }, NONE];
    case 'right':
      return [{ opacity: 0, translate: '160px 0px' }, NONE];
    case 'scale':
      return [{ opacity: 0, scale: '0.6' }, NONE];
    case 'pop':
      return [{ opacity: 0, scale: '0.3' }, { opacity: 1, scale: '1.08', offset: 0.7 }, NONE];
  }
}

/** Whether this DOM animates (a real Chromium does; happy-dom has no Web Animations). */
export const canAnimate = (el: Element): boolean => typeof (el as Element & { animate?: unknown }).animate === 'function';
