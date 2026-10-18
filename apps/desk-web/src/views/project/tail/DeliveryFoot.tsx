// A send's delivery state as the foot of its bubble (the owner's 1B, 2026-10-17; mockups/desk/09-session-view.html):
// under a hairline inside the bubble, a glyph and a few words, the full reason on hover. Its props are the whole of what
// it reads — the state, the short words, the reason — so the same foot can move into MAWS's `UserRow` when the owner
// proposes the style to the app; its look is `desk-delivery-foot` in the desk's stylesheet, keyed by `data-state`.
import type { FootState } from '../../../conversation/tail';

const GLYPH: Record<FootState, string> = {
  sending: '',
  queued: '◷',
  delivered: '✓',
  uncertain: '',
  recorded: '◇',
  'refused-read-only': '⊘',
  failed: '!',
  'not-sent': '!',
};

export function DeliveryFoot({ state, words, reason }: { state: FootState; words: string; reason: string | null }) {
  const glyph = GLYPH[state];
  return (
    <div className="desk-delivery-foot" data-state={state} data-testid="delivery-foot" title={reason ?? undefined}>
      {glyph && (
        <span className="desk-delivery-glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span>{words}</span>
    </div>
  );
}
