// The transcript as the shell mounts it (C8's ask, Public surface): one Transcript over the session's IPC source (a
// child agent's when `agentId` is given), with the actions every child registered merged over the defaults and the
// latest registered request-card renderer (C7's), re-rendered when either changes. A session transcript gets the
// receipt's rewind over `session.rewindFiles`; a child's does not (its turns are not the session's prompts, so there is
// nothing to rewind to). C5's `transcript` slot renders it through `transcript/shell.tsx`, registered from `App.tsx`.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useMemo } from 'react';
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
  return <Transcript source={source} variant={agentId === undefined ? 'session' : 'child'} actions={actions} rewind={rewind} renderRequest={renderRequest} className={className} />;
}
