// The editor's part of a file tab's bar (E5 execution document, M2's and M3's decisions): the last save's failure, why
// the disk's newer version cannot be offered when the editor cannot take it (E11 W-D), the disk's newer version (Changed on disk with Reload, Keep mine and Compare; once compared or found by a save, the merge
// view's line with its chunk count, ↑ ↓ through the chunks, Reload and Keep mine), the document's conflict blocks
// counted with ↑ ↓, and Save, shown while there is anything to save and disabled while a save runs. No CodeMirror here:
// the bar is in the main chunk; the counts and the stepping come from the shown code view (`navigation.ts`).
// UX wave U6e (K1, K14, K15; the named exception of docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md
// §D): the last save's failure is `SaveFailure`, which the bar lays out on a line of its own at its full width, wrapped
// and never cut, in every file tab.
import { useChordHint } from '../../../app/IconButton';
import { EDITOR_COPY } from '../copy';
import { useViewer, type ViewerEntry } from '../viewer/viewer-store';
import { step, useEditorNavigation } from './navigation';

// The buttons and counts keep their size in a narrow bar; the notice is what truncates (M4: the merge view's bar at a
// 600 px viewer wrapped Keep mine and drew Save over Wrap).
const control = 'shrink-0 whitespace-nowrap rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint';
const primary = 'shrink-0 whitespace-nowrap rounded-sm border border-border-strong bg-bg-raised px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover disabled:text-fg-faint';
const arrow = 'rounded-sm px-1 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint';

// A count with ↑ ↓ through what it counts in the shown code view.
function Counter({ tabId, kind, label, previous, next, count }: { tabId: string; kind: 'change' | 'conflict'; label: string; previous: string; next: string; count: number }) {
  const data = kind === 'change' ? { 'data-merge-changes': String(count) } : { 'data-conflicts': String(count) };
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span role="status" {...data} className="mr-0.5 whitespace-nowrap text-fg-muted">
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
  const { tabId, theirs, saving, saveError, dirty, diskUnusable, locked } = entry;
  const counts = useEditorNavigation((s) => s.counts.get(tabId));
  const changes = theirs?.view === 'merge' ? (counts?.changes ?? null) : null;
  const conflicts = changes === null ? (counts?.conflicts ?? 0) : 0;
  // UX wave U6e (the panel's finding 3): an entry whose latest admission locks it offers no Save; the ways out that write
  // nothing (Reload, Keep mine) stay
  const savable = locked === null && (dirty || theirs !== null);
  if (!savable && theirs === null && saveError === null && diskUnusable === null && conflicts === 0) return null;
  const viewer = useViewer.getState;
  return (
    <span data-editor-controls className="flex min-w-0 shrink items-center gap-1">
      {diskUnusable !== null && theirs === null ? (
        <span role="status" data-disk-unusable={diskUnusable} title={EDITOR_COPY.diskUnusable[diskUnusable]} className="min-w-0 truncate text-warning">
          {EDITOR_COPY.diskUnusable[diskUnusable]}
        </span>
      ) : null}
      {theirs !== null ? (
        <>
          <span role="status" data-theirs-notice={theirs.view} title={theirs.view === 'notice' ? EDITOR_COPY.changedOnDisk : EDITOR_COPY.conflictOnSave} className="min-w-0 truncate text-warning">
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
      {savable ? (
        <button
          type="button"
          className={primary}
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

// UX wave U6e (K1, K14): the last save's failure, a line of its own below the path (`basis-full` in the bar's wrapping
// row, after everything else in it), wrapped to as many lines as it needs and never cut, an unbroken run (a long path
// component) included.
export function SaveFailure({ entry }: { entry: ViewerEntry }) {
  if (entry.saveError === null) return null;
  return (
    <span role="alert" className="min-w-0 basis-full break-words wrap-anywhere text-danger">
      {EDITOR_COPY.saveFailed(entry.saveError)}
    </span>
  );
}
