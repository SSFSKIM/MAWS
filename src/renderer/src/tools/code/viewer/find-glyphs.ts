// The ⌘F find bar's controls as conventional glyphs (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// T336): ↓ and ↑ for next and previous, and Aa, .* and ab| as toggles, through the editor library's own phrases; "all",
// "replace" and "replace all" keep the library's words. Each glyph keeps its word as its accessible name and as its
// tooltip (`data-find-tip`, which the code theme draws on pointing and at once on keyboard focus: the library builds the
// bar's elements itself, so no React tip can own them). The words are set on the bar's elements once it is drawn,
// which the panels' own plugin does in the same update, ahead of this one.
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
