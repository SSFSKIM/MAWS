// The editor's part of a file tab's bar (E5 execution document, M2's decisions): the last save's failure, the disk's
// newer version (Changed on disk with Reload, Keep mine and Compare; once compared or found by a save, the merge view's
// line with Reload and Keep mine) and Save, shown while there is anything to save and disabled while a save runs. No
// CodeMirror here: the bar is in the main chunk.
import { useChordHint } from '../../../app/IconButton';
import { EDITOR_COPY } from '../copy';
import { useViewer, type ViewerEntry } from '../viewer/viewer-store';

const control = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint';
const primary = 'rounded-sm border border-border-strong bg-bg-raised px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover disabled:text-fg-faint';

export function EditorControls({ entry }: { entry: ViewerEntry }) {
  const saveChord = useChordHint('file.save');
  const { tabId, theirs, saving, saveError, dirty } = entry;
  if (!dirty && theirs === null && saveError === null) return null;
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
