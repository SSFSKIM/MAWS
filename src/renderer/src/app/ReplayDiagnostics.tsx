// The replay controls of the Store section (C4 execution document, M5; acceptance item 6): pick a fixture and a speed,
// start it, and drive each run — pause or resume, change speed, stop — reading `state · i / total · speed`. The run's
// session appears in the row list below as `replay · <fixture>`, and following it shows its events.
import { useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { Speed } from '@shared/ipc/schema/session';
import { describeProgress, describeSpeed, SPEEDS, useReplayDiagnostics, type ReplayRun } from '../stores/replay-diagnostics';

const speedOf = (value: string): Speed => (value === 'instant' ? 'instant' : Number(value));

const control = 'rounded-sm border border-border px-2 text-fg hover:bg-bg-hover disabled:text-fg-faint';

export function ReplayDiagnostics() {
  const fixtures = useReplayDiagnostics((s) => s.fixtures);
  const runs = useReplayDiagnostics((s) => s.runs);
  const error = useReplayDiagnostics((s) => s.error);
  const [path, setPath] = useState<string | null>(null);
  const [speed, setSpeed] = useState<Speed>(5);

  useEffect(() => useReplayDiagnostics.getState().connect(), []);

  const chosen = fixtures.find((fixture) => fixture.path === path) ?? fixtures[0];
  return (
    <div aria-label="Replay" className="flex flex-col gap-1 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 font-mono text-fg-faint">replay</span>
        <select aria-label="Replay fixture" className="min-w-0 flex-1 truncate rounded-sm border border-border bg-bg px-1 text-fg" value={chosen?.path ?? ''} onChange={(e) => setPath(e.target.value)}>
          {fixtures.map((fixture) => (
            <option key={fixture.id} value={fixture.path}>
              {fixture.name} · {fixture.kind}
            </option>
          ))}
        </select>
        <SpeedPicker label="Replay speed" speed={speed} onChange={setSpeed} />
        <button type="button" disabled={!chosen} onClick={() => chosen && void useReplayDiagnostics.getState().start(chosen, speed)} className={`shrink-0 ${control}`}>
          Start
        </button>
      </div>
      {error && (
        <output aria-label="replay error" className="font-mono text-fg">
          {error}
        </output>
      )}
      <ul aria-label="Replay runs" className="flex flex-col gap-1">
        {Object.entries(runs).map(([appSessionId, run]) => (
          <RunRow key={appSessionId} appSessionId={appSessionId as AppSessionId} run={run} />
        ))}
      </ul>
    </div>
  );
}

function RunRow({ appSessionId, run }: { appSessionId: AppSessionId; run: ReplayRun }) {
  const state = run.progress?.state;
  const send = (change: Parameters<ReturnType<typeof useReplayDiagnostics.getState>['control']>[1]) => void useReplayDiagnostics.getState().control(appSessionId, change);
  return (
    <li className="flex min-w-0 items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-fg">replay · {run.name}</span>
      <output aria-label="replay progress" className="shrink-0 font-mono">
        {describeProgress(run.progress)}
      </output>
      <button type="button" disabled={state !== 'running' && state !== 'paused'} onClick={() => send({ action: state === 'paused' ? 'resume' : 'pause' })} className={`shrink-0 ${control}`}>
        {state === 'paused' ? 'Resume' : 'Pause'}
      </button>
      <SpeedPicker label="Run speed" speed={run.progress?.speed ?? 1} disabled={state !== 'running' && state !== 'paused'} onChange={(speed) => send({ speed })} />
      <button type="button" onClick={() => send({ action: 'stop' })} className={`shrink-0 ${control}`}>
        Stop
      </button>
    </li>
  );
}

function SpeedPicker({ label, speed, disabled, onChange }: { label: string; speed: Speed; disabled?: boolean; onChange: (speed: Speed) => void }) {
  return (
    <select aria-label={label} disabled={disabled} className="shrink-0 rounded-sm border border-border bg-bg px-1 text-fg disabled:text-fg-faint" value={String(speed)} onChange={(e) => onChange(speedOf(e.target.value))}>
      {SPEEDS.map((option) => (
        <option key={String(option)} value={String(option)}>
          {describeSpeed(option)}
        </option>
      ))}
    </select>
  );
}
