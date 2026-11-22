// The ⌘F find bar's controls as conventional glyphs (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// T336): ↓ and ↑ for next and previous, and Aa, .* and ab| as toggles, through the editor library's own phrases; "all",
// "replace" and "replace all" keep the library's words. Each glyph keeps its word as its accessible name and as its
// tooltip (`data-find-tip`, drawn by `FIND_TIP_THEME`, which the code theme holds: the library builds the bar's elements
// itself, so no React tip can own them). The words are set on the bar's elements once it is drawn, which the panels'
// own plugin does in the same update, ahead of this one.
//
// One tip at a time, as `Tip`'s: a glyph that holds keyboard focus shows its tip at once; a pointed glyph shows its own
// after the pointing delay only while no other glyph holds focus, so two neighbours' tips never stack. A shown tip is
// part of its glyph, so the pointer can move onto it and keep it (WCAG 1.4.13): it sits flush under the glyph, its gap
// a transparent border the pointer crosses without leaving.
import { EditorState, type Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import { FIND_COPY } from '../copy';

export const FIND_TIP = 'data-find-tip';
const NAMED = 'data-find-named';

function nameControls(root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>(`.cm-search:not([${NAMED}])`);
  if (panel === null) return;
  panel.setAttribute(NAMED, '');
  for (const [name, word] of Object.entries(FIND_COPY.words)) {
    const control = panel.querySelector<HTMLElement>(`[name="${name}"]`);
    if (control === null) continue;
    control.setAttribute('aria-label', word);
    (control.closest('label') ?? control).setAttribute(FIND_TIP, word); // a toggle's box is hidden: its label is pointed at
  }
}

export const findGlyphs: Extension = [
  EditorState.phrases.of(FIND_COPY.glyphs),
  ViewPlugin.define((view) => {
    nameControls(view.dom);
    return { update: (update) => nameControls(update.view.dom) };
  }),
];

const OWNER = '.cm-panel.cm-search [data-find-tip]';
const FOCUSED = '[data-find-tip]:focus-visible, [data-find-tip]:has(input:focus-visible)';

export const FIND_TIP_THEME: Record<string, Record<string, string>> = {
  [OWNER]: { position: 'relative' },
  [`${OWNER}::after`]: {
    content: 'attr(data-find-tip)', position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', zIndex: '1',
    whiteSpace: 'nowrap', padding: '2px 8px', borderTop: '4px solid transparent', backgroundClip: 'padding-box', borderRadius: 'var(--radius-sm)',
    boxShadow: 'inset 0 0 0 1px var(--border-strong)', backgroundColor: 'var(--bg-overlay)', color: 'var(--fg)', fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-ui-sm)', pointerEvents: 'none', visibility: 'hidden', opacity: '0',
  },
  // pointed, while no glyph of the bar holds focus but this one (POINTING_DELAY_MS)
  [`.cm-panel.cm-search:not(:has(${FOCUSED})) [data-find-tip]:hover::after`]: { visibility: 'visible', opacity: '1', pointerEvents: 'auto', transition: 'visibility 0s 300ms, opacity 0s 300ms' },
  // focused from the keyboard: at once, whatever is pointed
  [`${OWNER}:focus-visible::after, ${OWNER}:has(input:focus-visible)::after`]: { visibility: 'visible', opacity: '1', pointerEvents: 'auto' },
};
