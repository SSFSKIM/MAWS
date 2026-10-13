// The preview's bar (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent), in place of the
// formatting toolbar while the editor shows a version: what is shown, its tab, Show changes (on by default), "N changes"
// with ↑ ↓, Restore this version (confirmed first), Make a copy, and Back to document.
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useState, type ReactNode } from 'react';
import type { HistoryController, Preview } from './controller';
import { changesOf, stepChange } from './paint';

export function HistoryBar({ editor, preview, controller, onBack }: { editor: Editor; preview: Preview; controller: HistoryController; onBack(): void }) {
  const [confirming, setConfirming] = useState(false);
  const count = useEditorState({ editor, selector: ({ editor: e }) => (e ? changesOf(e.state).changes.length : 0) });
  return (
    <>
      <div className="doc-toolbar doc-history-bar" role="toolbar" aria-label="Version preview">
        <span className="doc-history-heading">{preview.title}</span>
        {preview.tabs.length > 1 && (
          <select className="doc-toolbar-select" aria-label="Tab" value={preview.tabId ?? ''} onChange={(event) => controller.setTab(event.target.value)}>
            {preview.tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title || 'Untitled tab'}
              </option>
            ))}
          </select>
        )}
        <span className="doc-toolbar-separator" />
        <label className="doc-history-filter">
          <input type="checkbox" checked={preview.showChanges} onChange={(event) => controller.setShowChanges(event.target.checked)} />
          Show changes
        </label>
        {preview.showChanges && (
          <>
            <span className="doc-history-count" aria-live="polite">
              {count === 1 ? '1 change' : `${count} changes`}
            </span>
            <Button label="Previous change" disabled={count === 0} onClick={() => stepChange(editor, -1)}>
              ↑
            </Button>
            <Button label="Next change" disabled={count === 0} onClick={() => stepChange(editor, 1)}>
              ↓
            </Button>
          </>
        )}
        <span className="doc-toolbar-spacer" />
        {preview.versionId !== null && (
          <>
            <Button label="Restore this version" onClick={() => setConfirming(true)}>
              Restore this version
            </Button>
            <Button label="Make a copy" onClick={() => void controller.duplicate()}>
              Make a copy
            </Button>
          </>
        )}
        <Button label="Back to document" onClick={onBack}>
          Back to document
        </Button>
      </div>
      {confirming && (
        <div className="doc-history-confirm" role="alertdialog" aria-label="Restore this version?">
          <p>Restore this version? The document goes back to it as a new version; everything since stays in history, and comment conversations are kept.</p>
          <div className="doc-history-save-actions">
            <Button label="Cancel" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              label="Restore"
              onClick={() => {
                setConfirming(false);
                void controller.restore();
              }}
            >
              Restore
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Button({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="doc-tool" aria-label={label} title={label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}
