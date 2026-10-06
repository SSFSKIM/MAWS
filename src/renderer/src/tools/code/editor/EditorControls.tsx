// The editor's part of a file tab's bar (E5 execution document, M2's and M3's decisions): the last save's failure, the
// disk's newer version (Changed on disk with Reload, Keep mine and Compare; once compared or found by a save, the merge
// view's line with its chunk count, ↑ ↓ through the chunks, Reload and Keep mine), the document's conflict blocks
// counted with ↑ ↓, and Save, shown while there is anything to save and disabled while a save runs. No CodeMirror here:
// the bar is in the main chunk; the counts and the stepping come from the shown code view (`navigation.ts`).
import { useChordHint } from '../../../app/IconButton';
import { EDITOR_COPY } from '../copy';
import { useViewer, type ViewerEntry } from '../viewer/viewer-store';
import { step, useEditorNavigation } from './navigation';

const control = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint';
const primary = 'rounded-sm border border-border-strong bg-bg-raised px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover disabled:text-fg-faint';
const arrow = 'rounded-sm px-1 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint';

// A count with ↑ ↓ through what it counts in the shown code view.
function Counter({ tabId, kind, label, previous, next, count }: { tabId: string; kind: 'change' | 'conflict'; label: string; previous: string; next: string; count: number }) {
  const data = kind === 'change' ? { 'data-merge-changes': String(count) } : { 'data-conflicts': String(count) };
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span role="status" {...data} className="mr-0.5 text-fg-muted">
        {label}
      </span>
      <button type="button" className={arrow} aria-label={previous} title={previous} disabled={count === 0} onClick={() => step(tabId, kind, -1)}>
        ↑
      </button>
      <button type="button" className={arrow} aria-label={next} title={next} disabled={count === 0} onClick={() => step(tabId, kind, 1)}>
        ↓
      </button>
    </span>
  );
}

export function EditorControls({ entry }: { entry: ViewerEntry }) {
  const saveChord = useChordHint('file.save');
  const { tabId, theirs, saving, saveError, dirty } = entry;
  const counts = useEditorNavigation((s) => s.counts.get(tabId));
  const changes = theirs?.view === 'merge' ? (counts?.changes ?? null) : null;
  const conflicts = changes === null ? (counts?.conflicts ?? 0) : 0;
  if (!dirty && theirs === null && saveError === null && conflicts === 0) return null;
  const viewer = useViewer.getState;
  return (
    <span data-editor-controls className="flex min-w-0 shrink items-center gap-1">
      {saveError !== null ? (
        <span role="alert" title={EDITOR_COPY.saveFailed(saveError)} className="min-w-0 truncate text-danger">
          {EDITOR_COPY.saveFailed(saveError)}
        </span>
      ) : null}
      {theirs !== null ? (
        <>
          <span role="status" data-theirs-notice={theirs.view} className="shrink-0 text-warning">
            {theirs.view === 'notice' ? EDITOR_COPY.changedOnDisk : EDITOR_COPY.conflictOnSave}
          </span>
          {changes !== null ? (
            <Counter tabId={tabId} kind="change" count={changes} label={EDITOR_COPY.changesFromDisk(changes)} previous={EDITOR_COPY.previousChange} next={EDITOR_COPY.nextChange} />
          ) : null}
          <button type="button" className={control} disabled={saving} onClick={() => viewer().reload(tabId)}>
            {EDITOR_COPY.reload}
          </button>
          <button type="button" className={control} disabled={saving} onClick={() => viewer().keepMine(tabId)}>
            {EDITOR_COPY.keepMine}
          </button>
          {theirs.view === 'notice' ? (
            <button type="button" className={control} disabled={saving} onClick={() => viewer().compare(tabId)}>
              {EDITOR_COPY.compare}
            </button>
          ) : null}
        </>
      ) : null}
      {conflicts > 0 ? (
        <Counter tabId={tabId} kind="conflict" count={conflicts} label={EDITOR_COPY.conflicts(conflicts)} previous={EDITOR_COPY.previousConflict} next={EDITOR_COPY.nextConflict} />
      ) : null}
      {dirty || theirs !== null ? (
        <button
          type="button"
          className={`shrink-0 ${primary}`}
          disabled={saving}
          title={saveChord ? `${EDITOR_COPY.save} · ${saveChord}` : EDITOR_COPY.save}
          onClick={() => void viewer().save(tabId)}
        >
          {saving ? EDITOR_COPY.saving : EDITOR_COPY.save}
        </button>
      ) : null}
    </span>
  );
}
