// E4a (Task 3.3): find in page (Design §4 "Find bar"; Codex's `codex.threadFindBar.*` for a browser page). The bar's
// lifetime is main's find session: opening it sends `text: ''` so main knows the bar is open (Esc in the page then
// closes it, Decision Log 42), closing it sends `text: null` (main stops finding and clears the selection). Each
// keystroke starts a new search; Enter and ↓ go to the next match, ⇧Enter and ↑ to the previous; the count is main's last
// `found-in-page` result. A page with no view to search (suspended, failed, crashed, never navigated) says so.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { IconButton } from '../../../app/IconButton';
import { find } from '../actions';
import { BROWSER_COPY } from '../copy';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from '../icons';

export interface FindBarProps {
  tab: BrowserTab;
  focusRequest: number; // bumped to take the keyboard again (the bar asked for while open)
  onClose(): void;
}

// What the count reads: nothing before a search, Codex's "0 results" or "{active} / {matches} results" after one.
export function findMessage(tab: BrowserTab, text: string): string {
  const copy = BROWSER_COPY.find;
  if (tab.suspended || tab.url === '' || tab.loadError || tab.crashed || tab.failed) return copy.unavailable;
  if (text === '' || tab.find === null) return '';
  return tab.find.matches === 0 ? copy.noResults : copy.results(tab.find.active, tab.find.matches);
}

export function FindBar({ tab, focusRequest, onClose }: FindBarProps) {
  const copy = BROWSER_COPY.find;
  const [text, setText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { tabId } = tab;

  useEffect(() => {
    find({ tabId, text: '' });
    return () => find({ tabId, text: null });
  }, [tabId]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);

  const search = (next: string, nextMatchCase: boolean) => find({ tabId, text: next, forward: true, findNext: false, matchCase: nextMatchCase });
  const step = (forward: boolean) => {
    if (text !== '') find({ tabId, text, forward, findNext: true, matchCase });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const message = findMessage(tab, text);
  return (
    <div role="search" aria-label={copy.label} data-browser-find="" className="flex h-9 shrink-0 items-center gap-0.5 border-t border-border px-2">
      <input
        ref={input}
        aria-label={copy.label}
        placeholder={copy.placeholder}
        value={text}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setText(event.target.value);
          search(event.target.value, matchCase);
        }}
        onKeyDown={onKeyDown}
        className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2 text-ui text-fg outline-accent placeholder:text-fg-faint focus-visible:outline-2"
      />
      <span role="status" className="shrink-0 px-1.5 text-ui-sm text-fg-muted tabular-nums">
        {message}
      </span>
      <IconButton label={copy.previous} disabled={text === ''} onClick={() => step(false)}>
        <ChevronUpIcon />
      </IconButton>
      <IconButton label={copy.next} disabled={text === ''} onClick={() => step(true)}>
        <ChevronDownIcon />
      </IconButton>
      <IconButton
        label={copy.matchCase}
        pressed={matchCase}
        onClick={() => {
          setMatchCase(!matchCase);
          if (text !== '') search(text, !matchCase);
        }}
      >
        <span aria-hidden className="text-ui-sm leading-none">
          {copy.matchCaseGlyph}
        </span>
      </IconButton>
      <IconButton label={copy.close} onClick={onClose}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}
