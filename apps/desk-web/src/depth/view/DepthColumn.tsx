// The depth column (DX8's `depth` slot): the selected direct channel's session in depth. Its tabs are the desk's state:
// **Subagents**, the session's subagent tree, where opening an agent subscribes to that agent's own transcript;
// **Jobs**, the session's background shells and monitors, a shell's output opened under its row, and its MCP servers
// (DC9, `JobsPane.tsx`); **Diff**, the working tree against its base branch, asked for when the tab opens and on
// Refresh; and **Info**, where the session runs, its model, its context use and cost, and the engine's status (read when
// the tab opens and on Refresh). They read the session's main
// transcript through its per-session owner (`owner/session-owner.ts`), which the center's session view holds too, so
// the tree, the jobs, the diff and the usage come over the one subscription that draws the transcript there (DC9: the
// Transcript tab moved to the center, and the status word with it). An `Agent` row in the center opens its agent here, through the owner's
// open-agent request. Loaded as a chunk of its own the first time a session is selected.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { agentTree } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import type { SubagentRef } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { sessionName } from '../../log/projection';
import type { DepthSlotProps } from '../../shell/slots';
import { SessionLabel } from '../../shell/SessionLabel';
import type { DeskSession } from '../../shell/sessions';
import { jobsTabLabel } from '../jobs/jobs-copy';
import { useSessionOwner, type SessionOwner } from '../owner/session-owner';
import { DESK_ACTIONS } from './actions';
import { createDiffView, DiffPane } from './DiffPane';
import { JobsPane } from './JobsPane';
import { SessionInfo } from './SessionInfo';
import { SubagentDetail } from './SubagentDetail';
import { INITIAL_TREE_VIEW, SubagentTree, type TreeView } from './SubagentTree';
import { useKeptTranscript } from './TranscriptPane';

export default function DepthColumn({ project, session, plane }: DepthSlotProps) {
  if (!session) {
    return (
      <div className="flex h-full flex-col gap-2 p-4 text-ui-sm text-fg-muted" data-slot="depth">
        <div className="text-ui font-medium text-fg">Session depth</div>
        <p className="m-0 leading-5">Open a session to see its subagents, diff and details here.</p>
      </div>
    );
  }
  return <SessionDepth key={`${session.machine}\u0000${session.session}`} project={project} session={session} plane={plane} />;
}

type Tab = 'subagents' | 'jobs' | 'diff' | 'info';

function SessionDepth({ project, session, plane }: { project: string; session: DeskSession; plane: DepthSlotProps['plane'] }) {
  const owner = useSessionOwner(project, session, plane);
  const main = owner.main;
  const state = useKeptTranscript(owner.keeper);
  const [tab, setTab] = useState<Tab>('subagents');
  const [agent, setAgent] = useState<string | null>(null);
  const [treeView, setTreeView] = useState<TreeView>(INITIAL_TREE_VIEW);
  const [diffView] = useState(createDiffView);
  useAgentRequests(owner, (agentId) => {
    setTab('subagents');
    setAgent(agentId);
  });

  // An `Agent` call's row in a subagent's transcript opens that agent here, as one in the center does.
  const actions = useMemo<Partial<TranscriptActions>>(() => ({ ...DESK_ACTIONS, openSubagent: (ref: SubagentRef) => owner.openSubagent(ref) }), [owner]);

  const { tasks } = state;
  const running = agentTree(tasks).running;
  return (
    <section className="flex h-full min-h-0 flex-col" data-slot="depth" data-testid="depth" data-session={session.session} aria-label={`${sessionName(session)} in depth`}>
      <header className="flex items-baseline gap-2 border-b border-border px-4 py-2">
        <SessionLabel session={session} name="text-ui font-medium text-fg" muted="text-ui-sm text-fg-muted" />
      </header>
      <div role="tablist" aria-label="Session depth" className="flex shrink-0 gap-1 border-b border-border px-2">
        <TabButton tab="subagents" current={tab} onSelect={setTab}>
          Subagents{tasks.order.length > 0 ? ` · ${running > 0 ? `${running} running` : tasks.order.length}` : ''}
        </TabButton>
        <TabButton tab="jobs" current={tab} onSelect={setTab}>
          {jobsTabLabel(state.jobs)}
        </TabButton>
        <TabButton tab="diff" current={tab} onSelect={setTab}>
          Diff
        </TabButton>
        <TabButton tab="info" current={tab} onSelect={setTab}>
          Info
        </TabButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {tab === 'subagents' && (
          <div role="tabpanel" aria-label="Subagents" className="absolute inset-0 flex flex-col">
            {agent === null ? (
              <SubagentTree tasks={tasks} view={treeView} onView={setTreeView} onOpen={setAgent} statusesKnown={state.jobs !== null} />
            ) : (
              <SubagentDetail key={agent} project={project} session={session} plane={plane} agentId={agent} node={tasks.tasks.get(agent as never)} actions={actions} onBack={() => setAgent(null)} />
            )}
          </div>
        )}
        {tab === 'jobs' && (
          <div role="tabpanel" aria-label="Jobs" className="absolute inset-0 flex flex-col">
            <JobsPane controller={main} state={state} session={session} />
          </div>
        )}
        {tab === 'diff' && (
          <div role="tabpanel" aria-label="Diff" className="absolute inset-0 flex flex-col">
            <DiffPane controller={main} state={state} view={diffView} />
          </div>
        )}
        {tab === 'info' && (
          <div role="tabpanel" aria-label="Info" className="absolute inset-0 flex flex-col overflow-y-auto">
            <SessionInfo session={session} state={state} controller={main} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Takes each open-agent request the owner holds — one made while the column was closed, then each later one. */
function useAgentRequests(owner: SessionOwner, open: (agentId: string | null) => void): void {
  const pending = useStore(owner.agentRequest, (s) => s.request);
  useEffect(() => {
    if (pending === null) return;
    const request = owner.takeAgentRequest();
    if (request) open(request.agentId);
  });
}

function TabButton({ tab, current, onSelect, children }: { tab: Tab; current: Tab; onSelect: (tab: Tab) => void; children: ReactNode }) {
  const selected = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={`depth-tab-${tab}`}
      onClick={() => onSelect(tab)}
      className={`-mb-px h-8 border-b-2 px-2.5 text-ui-sm outline-accent focus-visible:outline-2 ${selected ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
    >
      {children}
    </button>
  );
}
