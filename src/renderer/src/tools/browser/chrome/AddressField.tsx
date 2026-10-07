// E4a (Task 3.3): the address field (Design §4 "Address field", §14; Decision Log 34 and 49). Unfocused it shows the
// page's address as `displayUrl` builds it, the host in the text colour and the rest muted, behind a lock for https and
// a struck lock for http, centered as Codex's is; an empty tab shows the placeholder. Focused (a click, or main's
// `focusAddress` for ⌘L pressed in the page) it holds the whole URL selected; typing opens the suggestions: the typed
// address, then the partition's history (`browser.history.suggest`, 60 ms after the last keystroke, the newest query's
// answer only). ↑ and ↓ move, Enter runs the highlighted row (the typed address by default), Esc puts the URL back and
// leaves. What goes to main is always a parsed URL, never the typed text; a refused scheme raises the chrome's line and
// keeps the text. A tab-less surface opens a tab for the address.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { DEFAULT_PARTITION, type BrowserTab } from '@shared/browser/tab';
import { displayUrl, resolveAddress } from '@shared/browser/url';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../../ipc/client';
import { navigate, openMainTab, openTab } from '../actions';
import { BROWSER_COPY } from '../copy';
import { holdCover } from '../covering';
import { InsecureIcon, LockIcon } from '../icons';
import { useSearchUrl } from '../settings';
import { raiseNotice } from '../store';
import { optionId, Suggestions } from './Suggestions';
import { addressRows, defaultRow, moveRow, type AddressRow, type HistorySuggestion } from './address-rows';

export const SUGGEST_DEBOUNCE_MS = 60;

export interface AddressFieldProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tab: BrowserTab | null;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function AddressField({ appSessionId, surface, tab, inputRef }: AddressFieldProps) {
  const searchUrl = useSearchUrl();
  const listId = useId();
  const [draft, setDraft] = useState<string | null>(null); // the field's text while focused; null unfocused
  const [listOpen, setListOpen] = useState(false); // typing opened the list
  const [history, setHistory] = useState<HistorySuggestion[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null); // null: the default row
  const asked = useRef(0); // the newest history query
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const url = tab?.url ?? '';
  const partition = tab?.partition ?? DEFAULT_PARTITION;
  const focused = draft !== null;

  const rows = focused && listOpen ? addressRows(draft, history, searchUrl) : [];
  const shown = rows.length > 0;
  const index = highlight ?? defaultRow(rows);

  useEffect(() => (shown ? holdCover() : undefined), [shown]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused, inputRef]);

  const suggest = (query: string) => {
    clearTimeout(timer.current);
    const mine = ++asked.current;
    timer.current = setTimeout(() => {
      void ipc.invoke('browser.history.suggest', { partition, query: query.trim() }).then((result) => {
        if (mine !== asked.current) return; // a newer query is out
        if (result.ok) setHistory(result.value.suggestions);
        else console.warn(`[browser] history suggestions failed: ${result.error.message}`);
      });
    }, SUGGEST_DEBOUNCE_MS);
  };

  const close = () => {
    clearTimeout(timer.current);
    asked.current++;
    setListOpen(false);
    setHistory([]);
    setHighlight(null);
  };

  const run = (row: AddressRow | null, text: string) => {
    let target: string;
    if (row !== null) {
      target = row.url;
    } else {
      if (text.trim() === '') return;
      const resolved = resolveAddress(text, searchUrl);
      if (resolved.kind === 'refused') {
        raiseNotice({ appSessionId, tabId: tab?.tabId ?? null, kind: 'refusedScheme', name: resolved.scheme });
        close();
        return;
      }
      target = resolved.url;
    }
    if (tab) navigate(tab.tabId, { url: target, typed: true });
    else void openTyped(target);
    inputRef.current?.blur();
  };

  // A surface with no tab: an empty tab of the session, navigated as typed (so the history counts it), shown where the
  // address was typed: the panel shows the session's selected tab, a main tab moves to the new tab's own.
  const openTyped = async (target: string) => {
    const opened = await openTab(appSessionId, null);
    if (!opened) return;
    navigate(opened.tabId, { url: target, typed: true });
    if (surface === 'main') openMainTab(appSessionId, opened.tabId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || draft === null) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown) return;
      event.preventDefault();
      setHighlight(moveRow(index, event.key === 'ArrowDown' ? 1 : -1, rows.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(rows[index] ?? null, draft);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      inputRef.current?.blur();
    }
  };

  const display = displayUrl(url);
  return (
    <div className="relative min-w-0 flex-1 px-1">
      <div
        className={`relative flex h-7 items-center rounded-md border px-2 ${focused ? 'border-border-strong bg-bg' : 'border-transparent hover:bg-bg-hover'}`}
        title={focused ? undefined : url || undefined}
      >
        {!focused && display.host !== '' && (
          <span data-address-display="" aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 overflow-hidden px-2 text-ui whitespace-nowrap">
            <span data-lock={display.scheme === 'https:' ? 'secure' : 'insecure'} className="contents">
              {display.scheme === 'https:' ? <LockIcon className="size-3.5 text-fg-muted" /> : <InsecureIcon className="size-3.5 text-fg-muted" />}
            </span>
            <span className="min-w-0 truncate">
              <span className="text-fg">{display.host}</span>
              <span className="text-fg-muted">{display.rest}</span>
            </span>
          </span>
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-label={BROWSER_COPY.address}
          aria-description={display.scheme === 'http:' ? BROWSER_COPY.notSecure : undefined}
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? listId : undefined}
          aria-activedescendant={shown && index >= 0 ? optionId(listId, index) : undefined}
          value={draft ?? ''}
          placeholder={display.host === '' ? BROWSER_COPY.addressPlaceholder : undefined}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => {
            close();
            setDraft(url);
          }}
          onBlur={() => {
            close();
            setDraft(null);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setListOpen(true);
            setHighlight(null);
            suggest(event.target.value);
          }}
          onKeyDown={onKeyDown}
          className={`h-full w-full min-w-0 bg-transparent text-ui text-fg outline-none placeholder:text-fg-faint ${focused ? '' : 'text-center'}`}
        />
      </div>
      {shown && <Suggestions id={listId} rows={rows} highlighted={index} onRun={(row) => run(row, draft ?? '')} />}
    </div>
  );
}
