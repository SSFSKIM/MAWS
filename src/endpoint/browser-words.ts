// `mawsd`'s browser words on RL2 (P5 O17 M9a; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K, the
// refresh's correction 4): the feed seam (`EndpointServices.browser`, src/shared/browser/screencast.ts) names why an open
// is refused or a subscription ends in underscored words; RL2's are hyphenated, and a stream's refusal has its own short
// vocabulary (`STREAM_REFUSALS`). One table reads each of `mawsd`'s words both ways: as the `streamRefused` of a
// `browser.screencast` open, and, for a word that ends a subscription after its open, as the stream's `streamClose`.
// A word this build does not know (a newer machine's, the seam being additive) is logged and crosses as
// `producer-failed`, or `unavailable` at an open: never as it came, since the device's validator holds the refusal to its list.
import type { ScreencastClose, StreamRefusal } from 'org-protocol';
import type { BrowserRefusalReason } from '@shared/browser/screencast';

export const BROWSER_WORDS: Readonly<Record<BrowserRefusalReason, { refused: StreamRefusal; closed?: ScreencastClose }>> = {
  // the engine's own end of a subscription (browserEngine.ended), or of an open it refused
  tab_closed: { refused: 'unknown', closed: 'tab-closed' }, // a tab no longer held: a fresh inventory may name another
  view_gone: { refused: 'unknown', closed: 'view-gone' },
  frame_too_large: { refused: 'unavailable', closed: 'frame-too-large' },
  producer_failed: { refused: 'unavailable', closed: 'producer-failed' },
  // the route's: another epoch, or another viewer controls the tab
  engine_changed: { refused: 'engine-changed', closed: 'engine-changed' },
  control_busy: { refused: 'control-busy' },
  // the controlling viewer's input overflowed: control closes, what was held down released
  input_overflow: { refused: 'unavailable', closed: 'input-overflow' },
  // the feed's own refusals of an open
  unavailable: { refused: 'unavailable' },
  viewers: { refused: 'busy' },
  invalid: { refused: 'malformed' },
  read_only: { refused: 'read-only' },
  closed: { refused: 'unavailable', closed: 'closed' },
};

/** Whether this build knows `word` (one it doesn't is logged by whoever reads it). */
export const isBrowserWord = (word: string): word is BrowserRefusalReason => Object.hasOwn(BROWSER_WORDS, word);

/** An open's refusal on the wire, for `mawsd`'s word. */
export function refusalWord(word: string): StreamRefusal {
  return isBrowserWord(word) ? BROWSER_WORDS[word].refused : 'unavailable';
}

/** A stream's close on the wire, for the word that ended its subscription: `producer-failed` for any word that ends none. */
export function closeWord(word: string): ScreencastClose {
  return (isBrowserWord(word) ? BROWSER_WORDS[word].closed : undefined) ?? 'producer-failed';
}
