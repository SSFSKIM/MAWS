// The preview's bar (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent), in place of the
// formatting toolbar while the editor shows a version: what is shown, its tab (with the tabs a comparison added,
// renamed or deleted marked as such, a deleted one still shown; a single tab's change named beside the heading), Show
// changes (on by default), "N changes" of the whole comparison with ↑ ↓ stepping through every tab's changes in order
// (a tab's own rename or deletion first, then its body's), Restore this version (confirmed first), Make a copy, Name this
// version (M8: its label alone, A's `artifacts.nameVersion`), and Back to document. The count is the controller's whole-document list, the one the pill counts.
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { DiffTab, TabChanges } from '../../history';
import type { HistoryController, Preview } from './controller';
import { changesOf, goToChange } from './paint';

interface Stop {
  tabId: string;
  /** A body change's index in its tab, or the tab's own change. */
  at: number | 'tab';
}
const stopsOf = (changes: readonly TabChanges[]): Stop[] =>
  changes.flatMap(({ tab, entry, body }) => [...(entry ? [{ tabId: tab.id, at: 'tab' as const }] : []), ...Array.from({ length: body }, (_, at) => ({ tabId: tab.id, at }))]);

// ↓ or ↑ over the whole comparison, wrapping: from what is reached in the shown tab, or, with nothing reached, from the
// shown tab's place in the tab order. Another tab's stop shows that tab and reaches it there.
function step(editor: Editor, preview: Preview, controller: HistoryController, direction: 1 | -1): void {
  const stops = stopsOf(preview.changes);
  if (stops.length === 0) return;
  const shown = preview.tabId;
  const { current } = changesOf(editor.state);
  const reached = current !== null ? current : preview.focus === 'tab' ? 'tab' : null;
  const at = reached === null ? -1 : stops.findIndex((stop) => stop.tabId === shown && stop.at === reached);
  let target: Stop;
  if (at >= 0) target = stops[(at + direction + stops.length) % stops.length];
  else {
    const order = preview.tabs.map((tab) => tab.id);
    const here = order.indexOf(shown ?? '');
    const first = stops.findIndex((stop) => order.indexOf(stop.tabId) >= here);
    target = direction === 1 ? stops[first >= 0 ? first : 0] : stops[((first >= 0 ? first : stops.length) - 1 + stops.length) % stops.length];
  }
  if (target.tabId !== shown) controller.setTab(target.tabId, target.at);
  else if (target.at === 'tab') {
    goToChange(editor, null);
    controller.setFocus('tab');
  } else {
    goToChange(editor, target.at);
    controller.setFocus(null);
  }
}

export function HistoryBar({ editor, preview, controller, onBack }: { editor: Editor; preview: Preview; controller: HistoryController; onBack(): void }) {
  const [confirming, setConfirming] = useState(false);
  const [naming, setNaming] = useState(false);
  // re-rendered as ↑ ↓ moves within the tab (the count itself is the whole comparison's)
  useEditorState({ editor, selector: ({ editor: e }) => (e ? changesOf(e.state).current : null) });
  const count = preview.changes.reduce((n, tab) => n + (tab.entry ? 1 : 0) + tab.body, 0);
  const shownTab = preview.tabs.find((tab) => tab.id === preview.tabId);
  const tabReached = preview.focus === 'tab' ? '' : undefined;
  const annotated = shownTab && tabLabel(shownTab, preview.showChanges) !== (shownTab.title || 'Untitled tab');
  return (
    <>
      <div className="doc-toolbar doc-history-bar" role="toolbar" aria-label="Version preview">
        <span className="doc-history-heading">{preview.title}</span>
        {preview.tabs.length === 1 && shownTab && annotated && (
          <span className="doc-history-tab" data-current={tabReached}>
            {tabLabel(shownTab, preview.showChanges)}
          </span>
        )}
        {preview.tabs.length > 1 && (
          <select className="doc-toolbar-select" aria-label="Tab" data-current={tabReached} value={preview.tabId ?? ''} onChange={(event) => controller.setTab(event.target.value)}>
            {preview.tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tabLabel(tab, preview.showChanges)}
              </option>
            ))}
          </select>
        )}
        {shownTab?.change === 'removed' && <span className="doc-history-tab-note">This tab was deleted.</span>}
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
            <Button label="Previous change" disabled={count === 0} onClick={() => step(editor, preview, controller, -1)}>
              ↑
            </Button>
            <Button label="Next change" disabled={count === 0} onClick={() => step(editor, preview, controller, 1)}>
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
            {controller.canName && (
              <Button label="Name this version" onClick={() => setNaming(true)}>
                Name this version
              </Button>
            )}
          </>
        )}
        <Button label="Back to document" onClick={onBack}>
          Back to document
        </Button>
      </div>
      {naming && <NameForm onName={(label) => controller.name(label)} onDone={() => setNaming(false)} />}
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

// A deleted tab is always named so (its content is what Restore would bring back); a new or renamed one while changes show.
function tabLabel(tab: DiffTab, showChanges: boolean): string {
  const title = tab.title || 'Untitled tab';
  if (tab.change === 'removed') return `${title} (deleted)`;
  if (!showChanges) return title;
  if (tab.change === 'added') return `${title} (new)`;
  if (tab.change === 'renamed') return `${title} (renamed from ${tab.previousTitle || 'Untitled tab'})`;
  return title;
}

function Button({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="doc-tool" aria-label={label} title={label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

// Name this version: the label only (the version keeps its note).
function NameForm({ onName, onDone }: { onName(label: string): Promise<boolean>; onDone(): void }) {
  const [label, setLabel] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (name === '') return;
    void onName(name).then((named) => named && onDone());
  };
  return (
    <form className="doc-history-save" aria-label="Name this version" onSubmit={submit}>
      <input aria-label="Version name" placeholder="Name, e.g. Draft to legal" maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
      <div className="doc-history-save-actions">
        <Button label="Cancel" onClick={onDone}>
          Cancel
        </Button>
        <button type="submit" className="doc-tool" disabled={label.trim() === ''}>
          Save
        </button>
      </div>
    </form>
  );
}
