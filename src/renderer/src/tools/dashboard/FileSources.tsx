// Local-source status belongs to the app's chrome, not the dashboard document. Check while its live body is shown;
// keep the last good snapshot until the owner's one-action reread commits. Historical previews never offer a write.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { listDatasets, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { onUpdate, type Doc } from '@artifacts/yjs';
import type { CommandOutput } from '@shared/ipc/schema';
import type { DatasetFileApi } from './file-source-api';
import './FileSources.css';

const CHECK_MS = 5_000;
type FileStatus = CommandOutput<'artifacts.datasetFiles'>;
export function FileSources({ doc, shown, api }: { doc: Doc | null; shown: boolean; api: DatasetFileApi }) {
  // A string snapshot makes descriptor replacements observable under the React Compiler too, without depending on a
  // mutable Doc's identity. Only file bindings restart the check; typing in the document does not reread source files.
  const bindings = useSyncExternalStore(
    (listener) => doc ? onUpdate(doc, () => listener()) : () => {},
    () => JSON.stringify(doc ? listDatasets(doc).filter(({ descriptor }) => descriptor.source.kind === 'file') : []),
  );
  const datasets = JSON.parse(bindings) as { id: string; descriptor: DatasetDescriptor }[];
  const [status, setStatus] = useState<FileStatus | null>(null);
  const [checkIssue, setCheckIssue] = useState('');
  const [actionIssue, setActionIssue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!shown || bindings === '[]') return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const result = await api.check();
        if (current) { setStatus(result); setCheckIssue(''); }
      } catch (error) {
        if (current) setCheckIssue(`Source files could not be checked: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (current) timer = setTimeout(() => void check(), CHECK_MS);
      }
    };
    void check();
    return () => { current = false; clearTimeout(timer); };
  }, [api, bindings, shown, refresh]);

  const reread = async (id: string) => {
    if (!status || busy) return;
    setBusy(id);
    setActionIssue('');
    try {
      await api.reread(id, status.revision);
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionIssue(`Not reread: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };
  const changed = status?.files.flatMap((file) => {
    const dataset = datasets.find(({ id, descriptor }) => id === file.id && descriptor.source.kind === 'file' && descriptor.source.ref === file.ref);
    return dataset && file.state !== 'current' ? [{ ...file, descriptor: dataset.descriptor }] : [];
  }) ?? [];
  if (!shown || datasets.length === 0 || (changed.length === 0 && !checkIssue && !actionIssue)) return null;
  return (
    <div className="dash-file-sources" role="status" aria-label="Dataset source files">
      {changed.map(({ id, state, descriptor }) => (
        <div key={id} className="dash-file-source">
          <span>{state === 'changed' ? `${descriptor.source.kind === 'file' ? descriptor.source.name : descriptor.title} changed. Showing the saved data.` : `${descriptor.source.kind === 'file' ? descriptor.source.name : descriptor.title} is unavailable. Showing the saved data.`}</span>
          {state === 'changed' && <button type="button" className="doc-tool" aria-label={`Reread ${descriptor.title}`} disabled={busy !== null} onClick={() => void reread(id)}>{busy === id ? 'Rereading…' : 'Reread'}</button>}
        </div>
      ))}
      {(checkIssue || actionIssue) && <p className="dash-file-source-issue">{actionIssue || checkIssue}</p>}
    </div>
  );
}
