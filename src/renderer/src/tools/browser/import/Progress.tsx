// The sheet's running state (E4b Design §3 to §9): the phase main last reported, with its count, and Cancel, the only
// way out (the sheet is not dismissible while a run goes on). Main reports only the phases a run reaches (a wrong key
// has no cookies phase; a category not chosen has none), so the view shows the latest one rather than a checklist. While
// the Keychain is asked, its line says which button to choose. The word cut (P385): the line names the category being
// imported, and nothing while the run starts, prepares, confirms or cleans up; the bar says it is working.
import { SECONDARY } from '../../../sessions/ui';
import { IMPORT_COPY } from './copy';
import { cancel, type ImportProgress } from './store';

export function Progress({ progress, cancelling }: { progress: ImportProgress | null; cancelling: boolean }) {
  const counted = progress !== null && progress.phase !== 'keychain' && progress.total > 1;
  const share = counted ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const name = progress ? IMPORT_COPY.phaseName(progress.phase) : null;
  return (
    <div className="flex flex-col gap-3">
      <div role="status" aria-live="polite" data-import-phase={progress?.phase ?? 'starting'} className="flex flex-col gap-1.5">
        {name !== null && <p className={`m-0 ${progress?.phase === 'keychain' ? 'text-fg' : 'text-fg-muted'}`}>{name}</p>}
        <div className="h-1 overflow-hidden rounded-sm bg-bg-active">
          <div className={`h-full bg-accent ${share === null ? 'w-1/3 animate-pulse motion-reduce:animate-none' : ''}`} style={share === null ? undefined : { width: `${share}%` }} />
        </div>
        {counted && <p className="m-0 text-ui-sm text-fg-muted">{IMPORT_COPY.progress(progress.done, progress.total)}</p>}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => cancel()} disabled={cancelling} className={SECONDARY}>
          {cancelling ? IMPORT_COPY.cancelling : IMPORT_COPY.cancel}
        </button>
      </div>
    </div>
  );
}
