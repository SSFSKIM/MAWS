// The depth column's Info tab: where the session runs (machine, directory, worktree, from `DeskSession`), what it is
// (DC5's session kind), the model of its latest response (the transcript's), its context use and cost (DX4 `usage`
// on the main subscription; `session-info.ts`), and the engine's version, release base, repository root and remote, and
// surfaces from `read status` (the desk control surface spec's M0) — read when the tab opens and on Refresh, where the
// session's plugin can answer it; where it cannot, the tab says so and what it would need. A Refresh that fails keeps
// the last answer drawn and says so beside the button.
import { useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { capabilities, kindOf, type SessionKind } from '../../conversation/capabilities';
import type { DeskSession } from '../../shell/sessions';
import { useConnected } from '../../views/conversation/desk-context';
import type { DepthTranscriptState, DeskTranscript } from '../source/desk-transcript';
import { contextLine, costLine, refreshError, statusLines } from './session-info';

const KIND: Record<SessionKind, string> = {
  bridged: 'Running, bridged',
  seat: 'Running as a background seat (no bridge)',
  terminal: 'Running in a terminal (no bridge)',
  'not-running': 'Not running',
  unknown: 'Unknown',
  offline: 'Machine offline',
};

export function SessionInfo({ session, state, controller }: { session: DeskSession; state: DepthTranscriptState; controller: DeskTranscript }) {
  const can = capabilities(session, useConnected()).status;
  const status = useStore(controller.state, (s) => s.status);
  useEffect(() => {
    if (can.can) controller.requestStatus();
  }, [controller, can.can]);
  const lines = statusLines(status, can, kindOf(session) === 'bridged');
  const failed = refreshError(status);
  return (
    <dl data-testid="depth-info" className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-ui-sm">
      <Item label="Machine" value={session.machineOnline === false ? `${session.machine} (offline)` : session.machine} id="machine" />
      <Item label="Directory" value={session.cwd || 'unknown'} id="cwd" mono />
      <Item label="Worktree" value={session.worktree || 'none'} id="worktree" mono />
      <Item label="Session" value={KIND[kindOf(session)]} id="kind" />
      <Item label="Model" value={state.model ?? 'unknown'} id="model" />
      <Item label="Context" value={contextLine(state.usage, session.presence?.bridge === true)} id="context" />
      <Item label="Cost" value={costLine(state.usage, session.presence?.bridge === true)} id="cost" />
      <Item label="Engine" value={lines.engine} id="engine" />
      <Item label="Root" value={lines.root} id="root" mono />
      <Item label="Repository" value={lines.repo} id="repo" mono />
      <Item label="Surfaces" value={lines.surfaces} id="surfaces" />
      {can.can ? (
        <dd className="col-start-2 m-0 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-fg-faint" data-testid="depth-info-refresh" disabled={status?.pending} onClick={() => controller.requestStatus()}>
            Refresh
          </button>
          {failed && (
            <span className="text-warning" role="status" data-testid="depth-info-status-error">
              {failed}
            </span>
          )}
        </dd>
      ) : (
        can.reason && (
          <dd className="col-start-2 m-0 text-fg-muted" data-testid="depth-info-status-reason">
            {can.reason}
          </dd>
        )
      )}
    </dl>
  );
}

function Item({ label, value, id, mono = false }: { label: string; value: ReactNode; id: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`m-0 min-w-0 break-all text-fg ${mono ? 'font-mono' : ''}`} data-testid={`depth-info-${id}`}>
        {value}
      </dd>
    </>
  );
}
