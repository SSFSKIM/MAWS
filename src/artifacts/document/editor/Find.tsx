// The find bar (D1's `Find.tsx`; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): a field, "N of M", next and
// previous; Enter steps forward, Shift+Enter back, Escape closes and clears the highlights.
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { findState } from './find-plugin';

export function FindBar({ editor, onClose }: { editor: Editor; onClose(): void }) {
  const [query, setQuery] = useState('');
  const { count, current } = useEditorState({ editor, selector: ({ editor: e }) => findState(e.state) });

  useEffect(() => () => void (editor.isDestroyed || editor.commands.clearFind()), [editor]);

  const search = (value: string) => {
    setQuery(value);
    editor.commands.setFindQuery(value);
  };
  const close = () => {
    editor.commands.clearFind();
    onClose();
    editor.commands.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) editor.commands.findPrevious();
      else editor.commands.findNext();
    }
  };

  return (
    <div className="doc-find" role="search">
      <input type="search" aria-label="Find in document" placeholder="Find" autoFocus value={query} onChange={(event) => search(event.target.value)} onKeyDown={onKeyDown} />
      <span className="doc-find-count" role="status">
        {query ? (count === 0 ? 'No results' : `${current + 1} of ${count}`) : ''}
      </span>
      <button type="button" className="doc-tool" aria-label="Previous match" disabled={count === 0} onClick={() => editor.commands.findPrevious()}>
        ↑
      </button>
      <button type="button" className="doc-tool" aria-label="Next match" disabled={count === 0} onClick={() => editor.commands.findNext()}>
        ↓
      </button>
      <button type="button" className="doc-tool" aria-label="Close find" onClick={close}>
        ✕
      </button>
    </div>
  );
}
