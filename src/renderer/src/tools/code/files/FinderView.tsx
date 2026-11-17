// Go to file's field, above Files' tree in every tree column (UX wave U6b-3b,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, M1; decisions 5, 9 and 10, "The look"). Its text is the
// session's for this run (`tree-state.ts`). It takes the keyboard when ⌘P asked for it for this tab (`finder.ts`, S2): at
// once when it is drawn and in view, else when it is; it selects its text, so typing replaces it. Its keys act only while
// no input method composes, and never on a ⌘ key (root UC-6): Esc empties the field and then gives the keyboard back to
// where ⌘P found it (over a narrow window's sheet, by dismissing the sheet: Decision Log 15); ↓, ↑ and Enter are the
// search's. When the field loses the keyboard while it is empty, the search ends (decision 9). It stands above the tree's
// context menu's trigger, so a right-click in it is a text field's own.
// M2 (decisions 4 to 8; M2 decisions 2 and 3): while the field holds text the list stands in the tree's place, the tree
// kept mounted for its hold on the git store and drawn again at its offset when the field is emptied. The list is a
// `listbox` of the files the search answered, the field naming its highlighted row, or one line that says why there is
// none. ⌘P (the field taking the request while it has the keyboard already) and the field taking the keyboard again ask
// the open filter again.
import { useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { AppSessionId } from '@shared/graph/ids';
import { shellGeometryOf } from '../../../app/shell-view';
import { dismissSheet } from '../../../panel/PanelRegion';
import { useWorkingFolder } from '../../../sessions/working-folder';
import { useLayout } from '../../../stores/layout';
import { FILES_COPY } from '../copy';
import type { Opened } from '../open-file';
import { drawnRows, keyboardBefore, takeKeyboard, useFinder, useKeyboardRequest, type Finder, type FinderState } from './finder';
import { folderFromEnd, measureIn } from './path-cut';
import { FILES_ROW_HEIGHT, indent, rowFonts, useWidth } from './row-metrics';
import { treeOf, useTreeState } from './tree-state';

// The look: one row of 33 px with its bottom border, so its line meets the file bar's; 8 px at each side (the tree's
// root indent); the app's own text-field outline, inside its box.
const FIELD =
  'h-[33px] w-full shrink-0 border-b border-border bg-transparent px-2 text-ui text-fg placeholder:text-fg-muted outline-accent focus-visible:outline-2 -outline-offset-2';

// The list's id, which the field names, and a row's, which the field names while it is highlighted (M2 decision 2).
export const resultsId = (tabId: string) => `files-results-${tabId}`;
const optionId = (tabId: string, index: number) => `${resultsId(tabId)}-${index}`;

const composing = (event: KeyboardEvent<HTMLInputElement>) => event.nativeEvent.isComposing || event.keyCode === 229;

// The field and, while it holds text, the list in the tree's place. `tree` draws the session's tree, told whether the list
// stands in its place (it stays mounted then, and draws nothing). `clicked`: a row's click opened a file (Files' pair of
// clicks keeps it).
export function FinderColumn({ appSessionId, tabId, visible, tree, clicked }: { appSessionId: AppSessionId; tabId: string; visible: boolean; tree(searching: boolean): ReactNode; clicked?(path: string, opened: Opened | null): void }) {
  const text = useTreeState((s) => treeOf(s, appSessionId).filter);
  const directory = useWorkingFolder(appSessionId)?.path ?? null;
  const finder = useFinder(appSessionId, directory, text);
  const searching = text !== '';
  const rows = drawnRows(finder.state);
  const drawn = searching && rows !== null && rows.length > 0;
  const at = finder.state.status === 'answered' && finder.state.rows.length > 0 ? finder.state.at : null;
  return (
    <>
      <FinderField appSessionId={appSessionId} tabId={tabId} visible={visible} text={text} finder={finder} expanded={drawn} activeId={at === null ? undefined : optionId(tabId, at)} />
      <div className="min-h-0 flex-1">
        {searching ? <FinderList tabId={tabId} directory={directory} state={finder.state} choose={finder.choose} clicked={clicked} /> : null}
        {tree(searching)}
      </div>
    </>
  );
}

function FinderField({ appSessionId, tabId, visible, text, finder, expanded, activeId }: { appSessionId: AppSessionId; tabId: string; visible: boolean; text: string; finder: Finder; expanded: boolean; activeId: string | undefined }) {
  const input = useRef<HTMLInputElement>(null);
  const asked = useKeyboardRequest({ into: 'filter', tabId });
  const { refresh, onKey, left } = finder;
  useEffect(() => {
    const element = input.current;
    if (asked === 0 || !visible || element === null || !takeKeyboard({ into: 'filter', tabId })) return;
    const had = document.activeElement === element; // ⌘P with the keyboard in the field: no focus event asks again
    element.focus({ preventScroll: true });
    element.select();
    if (had) refresh();
  }, [asked, visible, tabId, refresh]);

  const endFinding = () => {
    if (treeOf(useTreeState.getState(), appSessionId).finding === tabId) useTreeState.getState().setFinding(appSessionId, null);
  };
  // Esc in an empty field leaves it: the search ends first, and the page is drawn without it before the keyboard goes
  // back, since the element ⌘P found it in may be this tab's own file, hidden and inert while the tree stood in its place.
  // Where the keyboard cannot be given back (that element gone from the page, or still under an inert main area), the key
  // is not the field's (Decision Log 15). Over a narrow window's sheet the sheet is dismissed by its own path: for that
  // element, which takes the keyboard once main has left inert; with none, by the sheet's own Esc, and the search ends.
  // Elsewhere the key goes on to whatever stands behind, and the keyboard stays in the field.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return onKey(event);
    if (composing(event)) return;
    if (event.repeat) return void event.preventDefault(); // a held Esc does no more than its first press
    if (text !== '') {
      event.preventDefault(); // the key is the field's: no sheet or layer behind it closes on it
      return void useTreeState.getState().setFilter(appSessionId, '');
    }
    const back = keyboardBefore();
    if (back !== null) {
      flushSync(endFinding);
      if (back.closest('[inert]') === null) {
        event.preventDefault();
        return void back.focus({ preventScroll: true });
      }
    }
    if (!shellGeometryOf(useLayout.getState(), window.innerWidth).sheet) return;
    endFinding();
    if (back === null) return; // the sheet's own Esc dismisses it
    event.preventDefault();
    dismissSheet(back);
  };
  // A blur while the element still has the page's keyboard is the window losing it, not the field.
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    left();
    if (document.activeElement !== event.currentTarget && event.currentTarget.value === '') endFinding();
  };

  return (
    <input
      ref={input}
      type="text"
      role="combobox"
      aria-expanded={expanded}
      aria-controls={resultsId(tabId)}
      aria-activedescendant={activeId}
      aria-label={FILES_COPY.goToFile}
      placeholder={FILES_COPY.goToFile}
      autoComplete="off"
      spellCheck={false}
      data-files-filter=""
      value={text}
      onChange={(event) => useTreeState.getState().setFilter(appSessionId, event.target.value)}
      onKeyDown={onKeyDown}
      onFocus={refresh}
      onBlur={onBlur}
      className={FIELD}
    />
  );
}

// A line in the list's place (decision 4): the notice row's type, the failure in the danger colour as the tree's own
// "Could not list"; it wraps to as many lines as its sentence needs and is never cut.
const LINE = 'whitespace-normal break-words px-2 py-1 text-ui-sm';

function lineOf(state: FinderState): { line: 'none' | 'searching' | 'failed' | 'offline'; words: string } | null {
  if (state.status === 'answered') return state.rows.length === 0 ? { line: 'none', words: FILES_COPY.noMatchingFiles } : null;
  if (state.status === 'waiting') return state.shown === null ? { line: 'searching', words: FILES_COPY.searchingFiles } : null;
  if (state.status === 'failed') return { line: 'failed', words: FILES_COPY.searchFailed };
  if (state.status === 'offline') return { line: 'offline', words: state.words };
  return null;
}

function FinderList({ tabId, directory, state, choose, clicked }: { tabId: string; directory: string | null; state: FinderState; choose: Finder['choose']; clicked?(path: string, opened: Opened | null): void }) {
  const [width, measure] = useWidth(); // the rows' width, from which a row's folder gets its room
  const fonts = useMemo(() => rowFonts(), []);
  const rows = drawnRows(state) ?? [];
  const at = state.status === 'answered' ? state.at : null;
  const highlighted = at === null ? null : optionId(tabId, at);
  useEffect(() => {
    if (highlighted !== null) document.getElementById(highlighted)?.scrollIntoView?.({ block: 'nearest' }); // the highlight stays in view
  }, [highlighted, state]);
  const said = lineOf(state);
  if (said !== null) {
    return (
      <p role="status" data-files-line="" data-line={said.line} className={`${LINE} ${said.line === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
        {said.words}
      </p>
    );
  }
  const base = directory === null ? '' : `${directory.replace(/\/+$/, '')}/`;
  return (
    <div
      ref={measure}
      role="listbox"
      id={resultsId(tabId)}
      aria-label={FILES_COPY.goToFile}
      aria-busy={state.status === 'waiting' ? true : undefined}
      data-files-results=""
      className="h-full overflow-auto"
    >
      {rows.map((path, index) => (
        <ResultRow
          key={path}
          id={optionId(tabId, index)}
          path={path}
          rel={path.startsWith(base) ? path.slice(base.length) : path}
          highlighted={index === at}
          width={width}
          fonts={fonts}
          open={(how) => {
            const opened = choose(index, how);
            if (!how.keep && !how.main) clicked?.(path, opened);
          }}
        />
      ))}
    </div>
  );
}

// What a result row leaves of its width for the folder, besides its name, mirroring the classes it is drawn with: one
// level's indent (`indent(1)`, 20), the row's `pr-2` (8) and its `gap-1.5` (6). A change of any of these classes changes
// this number.
export const RESULT_ROW_FIXED = 20 + 8 + 6;

// A result (decision 4; "The look"): the tree's row at one level's indent, the file's name, then its folder from the
// working folder in the muted colour, which gives way first, cut at its start and gone below two characters of room; the
// row's title is its path from the working folder. A click is a tree row's (decision 6).
function ResultRow({ id, path, rel, highlighted, width, fonts, open }: { id: string; path: string; rel: string; highlighted: boolean; width: number; fonts: { name: string; folder: string }; open(how: { keep: boolean; main: boolean }): void }) {
  const cut = rel.lastIndexOf('/');
  const name = rel.slice(cut + 1);
  const whole = cut < 0 ? '' : rel.slice(0, cut + 1);
  // Until the list has a width (its first layout) the folder is drawn whole.
  const folder = whole === '' || width <= 0 ? whole : folderFromEnd(whole, width - RESULT_ROW_FIXED - measureIn(fonts.name)(name), measureIn(fonts.folder));
  return (
    <div
      id={id}
      role="option"
      aria-selected={highlighted}
      data-files-result=""
      data-path={path}
      title={rel}
      onClick={(event) => open({ keep: false, main: event.metaKey })}
      onDoubleClick={() => open({ keep: true, main: false })}
      className={`flex min-w-0 cursor-default items-center gap-1.5 overflow-hidden pr-2 text-ui text-fg ${highlighted ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
      style={{ ...indent(1), height: FILES_ROW_HEIGHT }}
    >
      <span data-name="" className="truncate">
        {name}
      </span>
      {folder ? (
        <span data-folder="" className="shrink-0 whitespace-nowrap text-ui-sm text-fg-muted">
          {folder}
        </span>
      ) : null}
    </div>
  );
}
