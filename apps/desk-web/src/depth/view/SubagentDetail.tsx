// One subagent opened from the tree (the DC6 plan's M2): MAWS's Subagents drill-in as it stands —
// `tools/agents/subagents/DrillIn.tsx`, copied and adapted — over the agent's own subscription (DX3 scopes it by
// `agentId`), whose transcript and stream are drawn as the main thread's are. The header is MAWS's: Back, the agent's
// glyph and title, `<model> · <elapsed> · <tokens>`, and who dispatched it. MAWS's drill-in also stops the agent and
// relays a message to it through its parent; neither is here (stopping an agent is not in phase 1). The agent's own
// background shells and monitors, which its subscription carries, stand above its transcript while it has any, each
// with Stop (DC10, `JobsPane`'s agent scope).
import { useRef, useState, type ReactNode } from 'react';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { SUBAGENTS_COPY } from '../../../../../src/renderer/src/tools/agents/copy';
import { elapsedOf, formatElapsed, formatTokens } from '../../../../../src/renderer/src/tools/agents/model/elapsed';
import { rowTitle, type TaskNode } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import { refOf, useTicker } from '../../../../../src/renderer/src/tools/agents/subagents/shared';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { SubagentGlyph } from '../../../../../src/renderer/src/transcript/view/rows/Subagent';
import { sessionName } from '../../log/projection';
import type { SessionPlane } from '../../shell/session-plane';
import type { DeskSession } from '../../shell/sessions';
import { DeskTranscript } from '../source/desk-transcript';
import { JobsPane } from './JobsPane';
import { TranscriptPane, transcriptStatus, useDeskTranscript } from './TranscriptPane';

type Props = {
  project: string;
  session: DeskSession;
  plane: SessionPlane;
  agentId: string;
  /** The agent's node in the main subscription's tree; absent while the tree does not hold it (before a snapshot names it). */
  node: TaskNode | undefined;
  actions: Partial<TranscriptActions>;
  onBack: () => void;
};

export function SubagentDetail({ project, session, plane, agentId, node, actions, onBack }: Props) {
  const [controller] = useState(() => new DeskTranscript({ plane, project, target: { machine: session.machine, session: session.session, agentId }, store: useTranscriptStore }));
  const state = useDeskTranscript(controller, session);
  const list = useRef<TranscriptListHandle>(null);

  const now = useTicker(node !== undefined && elapsedOf(node, 0)?.live === true);
  const elapsed = node ? elapsedOf(node, now) : null;
  // A meta names the model only when the Agent call asked for one; otherwise the agent's own latest response says it,
  // which the transcript's state publishes (read from its store, so the header follows the rows as they arrive).
  const meta = SUBAGENTS_COPY.header(
    node?.agent?.model ?? state.model ?? SUBAGENTS_COPY.modelUnknown,
    elapsed ? formatElapsed(elapsed.ms) : SUBAGENTS_COPY.elapsedUnavailable,
    node?.usage ? formatTokens(node.usage.totalTokens) : SUBAGENTS_COPY.tokensUnavailable,
  );

  return (
    <div data-view="agent" data-testid="depth-subagent" data-agent={agentId} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col border-b border-border">
        <BackButton onBack={onBack}>{SUBAGENTS_COPY.back}</BackButton>
        <div className="flex items-start gap-2.5 px-4 pt-2 pb-3">
          {node && <SubagentGlyph agent={refOf(node)} className="shrink-0 text-prose text-accent" />}
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-ui font-semibold">{node ? rowTitle(node) : agentId}</h2>
            <p data-part="agent-meta" className="m-0 truncate text-ui-sm text-fg-muted tabular-nums">
              {meta}
            </p>
            <p data-part="dispatched-by" className="m-0 truncate text-ui-sm text-fg-muted">
              {SUBAGENTS_COPY.dispatchedBy(sessionName(session))}
            </p>
          </div>
          <span className="shrink-0 text-ui-sm text-fg-muted" data-testid="depth-subagent-status">
            {transcriptStatus(state)}
          </span>
        </div>
      </header>
      <JobsPane controller={controller} state={state} session={session} scope="agent" />
      <TranscriptPane controller={controller} state={state} variant="child" actions={actions} list={list} />
    </div>
  );
}

function BackButton({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onBack} className="m-2 mb-0 h-7 self-start rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
      {children}
    </button>
  );
}
