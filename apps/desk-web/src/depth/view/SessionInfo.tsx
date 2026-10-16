// The depth column's Info tab: where the session runs (machine, directory, worktree, from `DeskSession`), what it is
// (DC5's session kind), the model of its latest response (the transcript's), and its context use and cost (DX4 `usage`
// on the main subscription; `session-info.ts`).
import type { ReactNode } from 'react';
import { kindOf, type SessionKind } from '../../conversation/capabilities';
import type { DeskSession } from '../../shell/sessions';
import type { DepthTranscriptState } from '../source/desk-transcript';
import { contextLine, costLine } from './session-info';

const KIND: Record<SessionKind, string> = {
  bridged: 'Running, bridged',
  seat: 'Running as a background seat (no bridge)',
  terminal: 'Running in a terminal (no bridge)',
  'not-running': 'Not running',
  unknown: 'Unknown',
  offline: 'Machine offline',
};

export function SessionInfo({ session, state }: { session: DeskSession; state: DepthTranscriptState }) {
  return (
    <dl data-testid="depth-info" className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-ui-sm">
      <Item label="Machine" value={session.machineOnline === false ? `${session.machine} (offline)` : session.machine} id="machine" />
      <Item label="Directory" value={session.cwd || 'unknown'} id="cwd" mono />
      <Item label="Worktree" value={session.worktree || 'none'} id="worktree" mono />
      <Item label="Session" value={KIND[kindOf(session)]} id="kind" />
      <Item label="Model" value={state.model ?? 'unknown'} id="model" />
      <Item label="Context" value={contextLine(state.usage)} id="context" />
      <Item label="Cost" value={costLine(state.usage)} id="cost" />
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
