// The transcript as the shell mounts it (C8's ask, Public surface): one Transcript over the session's IPC source (a
// child agent's when `agentId` is given), with the actions every child registered merged over the defaults and the
// latest registered request-card renderer (C7's), re-rendered when either changes. A session transcript gets the
// receipt's rewind over `session.rewindFiles`; a child's does not (its turns are not the session's prompts, so there is
// nothing to rewind to). C5's `transcript` slot renders it through `transcript/shell.tsx`, registered from `App.tsx`.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useMemo } from 'react';
import { useSessions } from '../../stores/sessions';
import { ipcRewind, ipcSource } from '../source/ipc';
import { useRegisteredActions, useRegisteredRequestRenderer } from './registry';
import { Transcript } from './Transcript';

export interface TranscriptSlotProps {
  appSessionId: AppSessionId;
  agentId?: AgentId;
  className?: string;
}

export function TranscriptSlot({ appSessionId, agentId, className }: TranscriptSlotProps) {
  const actions = useRegisteredActions();
  const renderRequest = useRegisteredRequestRenderer(); // C7's card; the placeholder until it registers
  const source = ipcSource(appSessionId, agentId); // memoised per key
  const rewind = useMemo(() => (agentId === undefined ? ipcRewind(appSessionId) : undefined), [appSessionId, agentId]);
  // Where the session runs, from its record (its worktree's checkout when it has one): the engine's Bash input names no
  // cwd, so a shell call shows this, labelled as the session's directory.
  const sessionDirectory = useSessions((state) => {
    const record = state.records.get(appSessionId);
    return record ? (record.worktree?.path ?? record.directory) : null;
  });
  return (
    <Transcript
      source={source}
      variant={agentId === undefined ? 'session' : 'child'}
      actions={actions}
      rewind={rewind}
      renderRequest={renderRequest}
      className={className}
      sessionDirectory={sessionDirectory}
    />
  );
}
