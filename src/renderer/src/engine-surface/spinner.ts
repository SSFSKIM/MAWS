// The Spinner site (R2; the waves plan's R2 rulings): while a turn works, a plugin that hooks the Spinner replaces only
// the working label's text. A drawn tree reads as its text; an answer that draws MAWS's own with the props rewritten
// reads as the rewritten word (or message) and suffix, as Claude Desktop draws it (c95e4d2cf-BLkI1oZK.js:10343-10351);
// otherwise the label is MAWS's own. Desktop's props and instance (`main`, one per session).
import type { AppSessionId } from '@shared/graph/ids';
import { useSurfaceSite } from './site';
import { drawsEngine, textOf } from './tree';

export const SPINNER_INSTANCE = 'main';
const ELLIPSIS = /(…|\.\.\.)$/;

export function spinnerProps(mode: 'requesting' | 'responding' | 'thinking' | 'tool-use'): Record<string, unknown> {
  return { word: 'Working', message: null, suffix: '…', mode };
}

// The text a plugin gives the working label, or null for MAWS's own.
export function useSpinnerText(appSessionId: AppSessionId | null, working: boolean, mode: 'requesting' | 'responding' | 'thinking' | 'tool-use' = 'requesting'): string | null {
  const answer = useSurfaceSite({ appSessionId, component: 'Spinner', instanceId: SPINNER_INSTANCE, props: spinnerProps(mode), enabled: working });
  if (!answer?.hooked) return null;
  if (!drawsEngine(answer.tree)) return textOf(answer.tree) || null;
  if (!answer.rewritten) return null;
  const { word, message, suffix } = answer.props as { word?: unknown; message?: unknown; suffix?: unknown };
  const text = typeof message === 'string' ? message : typeof word === 'string' ? word : null;
  if (text === null) return null;
  const tail = typeof suffix === 'string' ? suffix : '…';
  return tail === '…' && ELLIPSIS.test(text) ? text : text + tail;
}
