// The dev-only "Resume live" launcher (C7 execution document, "Dev-only resume launcher"; M4): until C10 ships the
// unstarted-session path there is no product way to put a live process behind a session record, so the Diagnostics
// tab lists the resumable records (not archived, with an engine session) and resumes one through `session.launch`,
// passing its Direct, Permission mode and extraSettings fields through literally. Rendered only under
// `import.meta.env.DEV` (Diagnostics' C7 block); C10 replaces it.
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import type { PermissionMode } from '@shared/graph/enums';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';
import { isResumable, parseExtraSettings, resumeSpec } from './resume-spec';
import { displayTitle } from '../../sessions/title';

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];
const control = 'rounded-sm border border-border bg-bg px-1 text-fg';
const button = 'shrink-0 rounded-sm border border-border px-2 text-fg hover:bg-bg-hover disabled:text-fg-faint';

export function ResumeLauncher({ client = ipc }: { client?: MawsBridge }) {
  const records = useSessions(useShallow((s) => [...s.records.values()].filter(isResumable)));
  const [direct, setDirect] = useState(false);
  const [mode, setMode] = useState<PermissionMode | null>(null);
  const [extra, setExtra] = useState('');
  const [outcomes, setOutcomes] = useState<ReadonlyMap<AppSessionId, string>>(new Map());
  const parsed = parseExtraSettings(extra);

  const resume = async (appSessionId: AppSessionId) => {
    const record = useSessions.getState().records.get(appSessionId);
    if (!record || !isResumable(record) || !parsed.ok) return;
    const spec = resumeSpec(record, { direct, permissionMode: mode, extraSettings: parsed.value });
    const say = (text: string) => setOutcomes((o) => new Map(o).set(appSessionId, text));
    say('…');
    const result = await client.invoke('session.launch', { spec });
    if (!result.ok) return say(`${result.error.code}: ${result.error.message}`);
    const launch = result.value;
    say(launch.status === 'launching' ? 'launching' : launch.status === 'refused' ? `refused · ${launch.message}` : 'relay unreachable');
  };

  return (
    <div aria-label="Resume live" className="flex w-full flex-col gap-1 border-t border-border pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="shrink-0 font-mono text-fg-faint">resume live · dev</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
          Direct
        </label>
        <select aria-label="Permission mode" className={control} value={mode ?? ''} onChange={(e) => setMode(e.target.value === '' ? null : (e.target.value as PermissionMode))}>
          <option value="">from settings</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {PERMISSION_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <input aria-label="extraSettings" placeholder='extraSettings JSON, e.g. { "permissions": { "ask": ["Bash(git log:*)"] } }' className={`min-w-64 flex-1 font-mono ${control}`} value={extra} onChange={(e) => setExtra(e.target.value)} />
      </div>
      {!parsed.ok && <output className="font-mono text-warning">{parsed.error}</output>}
      <ul aria-label="Resumable sessions" className="m-0 flex list-none flex-col gap-0.5 p-0">
        {records.map((record) => (
          <li key={record.appId} className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate text-fg">{displayTitle(record)}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{record.directory}</span>
            {outcomes.has(record.appId) && (
              <output role="status" className="shrink-0 font-mono">
                {outcomes.get(record.appId)}
              </output>
            )}
            <button type="button" disabled={!parsed.ok} title={parsed.ok ? undefined : parsed.error} className={button} onClick={() => void resume(record.appId)}>
              Resume live
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
