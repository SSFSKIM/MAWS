// The depth column (DX8's `depth` slot): the selected direct channel's session in depth. Its tabs are DC6's state:
// **Transcript** (M1), the session's main transcript drawn by MAWS's transcript view over the session plane, streaming
// per content block, older rows paged in at the top; and **Subagents** (M2), the session's subagent tree from the main
// subscription, where opening an agent subscribes to that agent's own transcript; **Diff** (M3), the working tree against
// its base branch, asked for on the main subscription when the tab opens and on Refresh; and **Info** (M3), where the
// session runs, its model, and its context use and cost. The main subscription lives with the column whichever tab
// shows — the tree, the diff, and the usage are its — and its view stays mounted beneath the other tabs, so the
// reader's place in it is kept. Loaded as a chunk of its own the first time a session is selected.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { agentTree } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import type { SubagentRef } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import type { DepthSlotProps } from '../../shell/slots';
import type { DeskSession } from '../../shell/sessions';
import { DeskTranscript } from '../source/desk-transcript';
import { DESK_ACTIONS } from './actions';
import { createDiffView, DiffPane } from './DiffPane';
import { SessionInfo } from './SessionInfo';
import { SubagentDetail } from './SubagentDetail';
import { INITIAL_TREE_VIEW, SubagentTree, type TreeView } from './SubagentTree';
import { TranscriptPane, transcriptStatus, useDeskTranscript } from './TranscriptPane';

export default function DepthColumn({ project, session, plane }: DepthSlotProps) {
  if (!session) {
    return (
      <div className="flex h-full flex-col gap-2 p-4 text-ui-sm text-fg-muted" data-slot="depth">
        <div className="text-ui font-medium text-fg">Session depth</div>
        <p className="m-0 leading-5">Open a session to see its transcript here.</p>
      </div>
    );
  }
  return <SessionDepth key={`${session.machine}\u0000${session.session}`} project={project} session={session} plane={plane} />;
}

type Tab = 'transcript' | 'subagents' | 'diff' | 'info';

function SessionDepth({ project, session, plane }: { project: string; session: DeskSession; plane: DepthSlotProps['plane'] }) {
  const [main] = useState(() => new DeskTranscript({ plane, project, target: { machine: session.machine, session: session.session, agentId: null }, store: useTranscriptStore }));
  const state = useDeskTranscript(main, session);
  const list = useRef<TranscriptListHandle>(null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [agent, setAgent] = useState<string | null>(null);
  const [treeView, setTreeView] = useState<TreeView>(INITIAL_TREE_VIEW);
  const [diffView] = useState(createDiffView);

  // An `Agent` call's row in the main transcript opens that agent here, as MAWS's opens its Subagents tool on it. Before
  // the tree names the agent the row's ref holds the call's id, which the tree resolves once it does; until then the
  // tree is shown. Read at the click, so the actions stay one object for the view.
  const actions = useMemo<Partial<TranscriptActions>>(
    () => ({
      ...DESK_ACTIONS,
      openSubagent: (ref: SubagentRef) => {
        if (ref.kind === 'workflow') return;
        const id = String(ref.agentId ?? ref.taskId);
        const pending = ref.toolUseId !== null && id === String(ref.toolUseId);
        const resolved = pending ? main.state.getState().tasks.byToolUse.get(ref.toolUseId!) : id;
        setTab('subagents');
        setAgent(resolved === undefined ? null : String(resolved));
      },
    }),
    [main],
  );

  const { tasks } = state;
  const running = agentTree(tasks).running;
  return (
    <section className="flex h-full min-h-0 flex-col" data-slot="depth" data-testid="depth" data-session={session.session} aria-label={`${session.alias} in depth`}>
      <header className="flex items-baseline gap-2 border-b border-border px-4 py-2">
        <span className="truncate text-ui font-medium text-fg">{session.alias}</span>
        <span className="text-ui-sm text-fg-muted">@{session.machine}</span>
        <span className="ml-auto text-ui-sm text-fg-muted" data-testid="depth-status">
          {transcriptStatus(state)}
        </span>
      </header>
      <div role="tablist" aria-label="Session depth" className="flex shrink-0 gap-1 border-b border-border px-2">
        <TabButton tab="transcript" current={tab} onSelect={setTab}>
          Transcript
        </TabButton>
        <TabButton tab="subagents" current={tab} onSelect={setTab}>
          Subagents{tasks.order.length > 0 ? ` · ${running > 0 ? `${running} running` : tasks.order.length}` : ''}
        </TabButton>
        <TabButton tab="diff" current={tab} onSelect={setTab}>
          Diff
        </TabButton>
        <TabButton tab="info" current={tab} onSelect={setTab}>
          Info
        </TabButton>
      </div>
      <div className="relative min-h-0 flex-1">
        <div role="tabpanel" aria-label="Transcript" inert={tab !== 'transcript'} className={`absolute inset-0 flex flex-col ${tab === 'transcript' ? '' : 'invisible'}`}>
          <TranscriptPane controller={main} state={state} variant="session" actions={actions} list={list} />
        </div>
        {tab === 'subagents' && (
          <div role="tabpanel" aria-label="Subagents" className="absolute inset-0 flex flex-col">
            {agent === null ? (
              <SubagentTree tasks={tasks} view={treeView} onView={setTreeView} onOpen={setAgent} />
            ) : (
              <SubagentDetail key={agent} project={project} session={session} plane={plane} agentId={agent} node={tasks.tasks.get(agent as never)} actions={actions} onBack={() => setAgent(null)} />
            )}
          </div>
        )}
        {tab === 'diff' && (
          <div role="tabpanel" aria-label="Diff" className="absolute inset-0 flex flex-col">
            <DiffPane controller={main} state={state} view={diffView} />
          </div>
        )}
        {tab === 'info' && (
          <div role="tabpanel" aria-label="Info" className="absolute inset-0 flex flex-col overflow-y-auto">
            <SessionInfo session={session} state={state} />
          </div>
        )}
      </div>
    </section>
  );
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
