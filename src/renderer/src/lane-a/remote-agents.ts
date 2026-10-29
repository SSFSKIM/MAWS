// Another machine's terminal session in the agents tool (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// "Remote gaps": a subagent's own rows are withheld; the tree and its statuses still show). The task graph store's watch
// of such a session (a listed lane A row, no record here) holds the session's plane transcript open and reads the
// subagent tree it keeps, MAWS's task graph over the DX4 metas and held rows with each agent's DX4 status laid over it,
// as desk-web's depth column reads it. The plane code loads with the first such watch (`./remote-source`), so the
// window's entry chunk does not carry it.
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { registerRemoteTaskFeed } from '../tools/agents/store';
import { isRemoteLaneA } from './remote-session';

const servesRemote = (appSessionId: AppSessionId): boolean => !useSessions.getState().records.has(appSessionId) && isRemoteLaneA(appSessionId);

export function connectRemoteAgents(): () => void {
  return registerRemoteTaskFeed((appSessionId) => {
    if (!servesRemote(appSessionId)) return null;
    return (onGraph) => {
      let gone = false;
      let off = () => {};
      void import('./remote-source').then(({ holdRemoteTranscript, remoteTranscriptOf }) => {
        if (gone) return;
        const transcript = remoteTranscriptOf(appSessionId);
        const release = holdRemoteTranscript(appSessionId, transcript);
        onGraph(transcript.state.getState().tasks);
        const offTasks = transcript.state.subscribe((now, before) => {
          if (now.tasks !== before.tasks) onGraph(now.tasks);
        });
        off = () => {
          offTasks();
          release();
        };
      });
      return () => {
        gone = true;
        off();
      };
    };
  });
}
