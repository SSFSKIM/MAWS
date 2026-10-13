// The mention picker (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Decision Log 22 and 25): Insert ›
// Mention with a source of people, sessions and artifacts (the shell's, over L's library reads and the session list)
// opens a search field over the page's toolbar; the results follow the query, ↑ ↓ move, Enter or a click inserts the
// chosen `mention {kind, ref, label}` at the caret, Escape leaves the document as it was. App chrome (chrome.css).
import { useEffect, useId, useState, type KeyboardEvent } from 'react';

export interface MentionTarget {
  kind: 'person' | 'session' | 'artifact';
  ref: string;
  label: string;
  /** What the row says beside the label (an artifact's kind, "Session"). */
  detail?: string;
}

/** Who and what can be mentioned: the targets matching a query (an empty query: the likely ones). */
export interface MentionSource {
  search(query: string): Promise<MentionTarget[]>;
}

const SEARCH_QUIET_MS = 120;

export function MentionPicker({ source, onPick, onClose }: { source: MentionSource; onPick(target: MentionTarget): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; targets: MentionTarget[] } | null>(null);
  const [at, setAt] = useState(0);
  const list = useId();

  // The newest query's answer wins; a slower answer to an older one is dropped.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        void source.search(query).then(
          (targets) => {
            if (!live) return;
            setResults({ query, targets });
            setAt(0);
          },
          () => live && setResults({ query, targets: [] }),
        );
      },
      query === '' ? 0 : SEARCH_QUIET_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, query]);

  const targets = results?.targets ?? [];
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowDown' && targets.length > 0) setAt((at + 1) % targets.length);
    else if (event.key === 'ArrowUp' && targets.length > 0) setAt((at - 1 + targets.length) % targets.length);
    else if (event.key === 'Enter' && targets[at]) onPick(targets[at]);
    else return;
    event.preventDefault();
  };
  const optionId = (i: number) => `${list}-${i}`;
  return (
    <div className="doc-popover doc-mention-picker">
      <input
        role="combobox"
        aria-label="Mention"
        aria-expanded={targets.length > 0}
        aria-controls={list}
        aria-activedescendant={targets[at] ? optionId(at) : undefined}
        placeholder="A person, session or artifact"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul id={list} role="listbox" aria-label="Mention results" className="doc-mention-results">
        {results !== null && targets.length === 0 && <li className="doc-mention-empty">{query ? `Nothing matches “${query}”.` : 'Nothing to mention yet.'}</li>}
        {targets.map((target, i) => (
          <li
            key={`${target.kind}:${target.ref}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === at}
            className="doc-mention-option"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setAt(i)}
            onClick={() => onPick(target)}
          >
            <span className="doc-mention-label">@{target.label}</span>
            {target.detail && <span className="doc-mention-detail">{target.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
