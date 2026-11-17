// Go to file's field, above Files' tree in every tree column (UX wave U6b-3b,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, M1; decisions 5, 9 and 10, "The look"). Its text is the
// session's for this run (`tree-state.ts`). It takes the keyboard when ⌘P asked for it for this tab (`finder.ts`, S2): at
// once when it is drawn and in view, else when it is; it selects its text, so typing replaces it. Its keys act only while
// no input method composes, and never on a ⌘ key (root UC-6): in M1, Esc alone, which empties the field and then gives
// the keyboard back to where ⌘P found it. When the field loses the keyboard while it is empty, the search ends (decision 9).
// It stands above the tree's context menu's trigger, so a right-click in it is a text field's own. M2 draws the list in
// the tree's place.
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import type { AppSessionId } from '@shared/graph/ids';
import { FILES_COPY } from '../copy';
import { keyboardBefore, takeKeyboard, useKeyboardRequest } from './finder';
import { treeOf, useTreeState } from './tree-state';

// The look: one row of 33 px with its bottom border, so its line meets the file bar's; 8 px at each side (the tree's
// root indent); the app's own text-field outline, inside its box.
const FIELD =
  'h-[33px] w-full shrink-0 border-b border-border bg-transparent px-2 text-ui text-fg placeholder:text-fg-muted outline-accent focus-visible:outline-2 -outline-offset-2';

// The list's id, which the field names (M2 draws it).
export const resultsId = (tabId: string) => `files-results-${tabId}`;

const composing = (event: KeyboardEvent<HTMLInputElement>) => event.nativeEvent.isComposing || event.keyCode === 229;

export function FinderField({ appSessionId, tabId, visible }: { appSessionId: AppSessionId; tabId: string; visible: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const text = useTreeState((s) => treeOf(s, appSessionId).filter);
  const asked = useKeyboardRequest({ into: 'filter', tabId });
  useEffect(() => {
    const element = input.current;
    if (asked === 0 || !visible || element === null || !takeKeyboard({ into: 'filter', tabId })) return;
    element.focus({ preventScroll: true });
    element.select();
  }, [asked, visible, tabId]);

  const endFinding = () => {
    if (treeOf(useTreeState.getState(), appSessionId).finding === tabId) useTreeState.getState().setFinding(appSessionId, null);
  };
  // Esc in an empty field leaves it: the search ends first, and the page is drawn without it before the keyboard goes
  // back, since the element ⌘P found it in may be this tab's own file, hidden and inert while the tree stood in its place.
  // With that element gone from the page the keyboard stays in the field, and so does the search.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault(); // the key is the field's: no sheet or layer behind it closes on it
    if (event.repeat) return;
    if (text !== '') return void useTreeState.getState().setFilter(appSessionId, '');
    const back = keyboardBefore();
    if (back === null) return;
    flushSync(endFinding);
    back.focus({ preventScroll: true });
  };
  // A blur while the element still has the page's keyboard is the window losing it, not the field.
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (document.activeElement !== event.currentTarget && event.currentTarget.value === '') endFinding();
  };

  return (
    <input
      ref={input}
      type="text"
      role="combobox"
      aria-expanded={false}
      aria-controls={resultsId(tabId)}
      aria-label={FILES_COPY.goToFile}
      placeholder={FILES_COPY.goToFile}
      autoComplete="off"
      spellCheck={false}
      data-files-filter=""
      value={text}
      onChange={(event) => useTreeState.getState().setFilter(appSessionId, event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={FIELD}
    />
  );
}
