// The Subagents drill-in (C8b execution document, M2; K2; mockup 03 study 02): Back, the agent's identity with
// `<model> · <elapsed> · <tokens>` (no effort cell: no source gives a child's effort), `Dispatched by <session>` and
// `Stop agent` behind a confirmation; C6's `Transcript variant: 'child'` over the child's own `ipcSource`, which it
// mounts and never builds (the store's one attachment is shared with C5's agent tab), with the registered actions and
// C7's inline request card, so a child's permission is answered in place; then the relay composer.
import { Popover } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import type { AgentId, AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { SessionPhase } from '@shared/ipc/schema/session';
import type { PanelToolContext } from '../../../panel/tool';
import { renderInlineRequest } from '../../../composer';
import { useSessions } from '../../../stores/sessions';
import { ipcSource, SubagentGlyph, Transcript, useRegisteredActions, useTranscriptStore, type TranscriptSource } from '../../../transcript';
import { agentTranscriptActions } from '../actions';
import { SUBAGENTS_COPY } from '../copy';
import { elapsedOf, formatElapsed, formatTokens } from '../model/elapsed';
import { rowTitle, type TaskNode } from '../model/task-graph';
import { useTaskGraph } from '../store';
import { RelayComposer } from './RelayComposer';
import { agentOfToolUse, refOf, taskOf, useTicker } from './shared';
import type { SubagentsHandle } from './SubagentsTool';
import { displayTitle } from '../../../sessions/title';

// The child's source: C6's `ipcSource` in the product; the `#panel` harness sets `HarnessSession.childSource(ref)` here
// (as C8a's `child` tool mounts it), so the product path stays `ipcSource`.
type ChildSourceFor = (appSessionId: AppSessionId, agentId: AgentId) => TranscriptSource;
let childSourceOverride: ChildSourceFor | null = null;
export function setChildSourceFor(sourceFor: ChildSourceFor | null): void {
  childSourceOverride = sourceFor;
}
const childSourceFor: ChildSourceFor = (appSessionId, agentId) => childSourceOverride?.(appSessionId, agentId) ?? ipcSource(appSessionId, agentId);

// C5's liveness rule as its digest carries it (the one C6's shell transcript applies to its keys): a child runs in its
// parent's process, so the parent's phase says whether the child's key may tick.
const LIVE_PHASES: ReadonlySet<SessionPhase> = new Set(['starting', 'working', 'waiting', 'idle']);

function BackButton({ handle }: { handle: SubagentsHandle }) {
  return (
    <button type="button" onClick={handle.back} className="m-2 mb-0 h-7 self-start rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
      {SUBAGENTS_COPY.back}
    </button>
  );
}

interface Props {
  appSessionId: AppSessionId;
  agentId: AgentId;
  handle: SubagentsHandle;
  draft: string;
  ctx: PanelToolContext;
}

export function DrillIn({ appSessionId, agentId, handle, draft, ctx }: Props) {
  const node = useTaskGraph((s) => s.entries.get(appSessionId)?.graph.tasks.get(taskOf(agentId)));
  const sessionTitle = displayTitle(ctx.session);
  const title = node ? rowTitle(node) : agentId;

  const source = useMemo(() => childSourceFor(appSessionId, agentId), [appSessionId, agentId]);
  const registered = useRegisteredActions();
  const actions = useMemo(() => ({ ...registered, ...agentTranscriptActions }), [registered]);
  const renderRequest = useMemo(() => renderInlineRequest(appSessionId), [appSessionId]);

  // The key's liveness, as C6's shell transcript tells it for C5's agent tab: an unset key ticks from the wall clock.
  const live = useSessions((s) => LIVE_PHASES.has(s.digests.get(appSessionId)?.phase as SessionPhase));
  useEffect(() => {
    const key = source.key;
    if (!key) return;
    useTranscriptStore.getState().setLive(key, live);
    return () => useTranscriptStore.getState().setLive(key, null);
  }, [source, live]);

  const ticking = node !== undefined && elapsedOf(node, 0)?.live === true && ctx.visible;
  const now = useTicker(ticking);
  const elapsed = node ? elapsedOf(node, now) : null;
  const meta = SUBAGENTS_COPY.header(
    node?.agent?.model ?? ctx.status?.subagentModel ?? SUBAGENTS_COPY.modelUnknown,
    elapsed ? formatElapsed(elapsed.ms) : SUBAGENTS_COPY.elapsedUnavailable,
    node?.usage ? formatTokens(node.usage.totalTokens) : SUBAGENTS_COPY.tokensUnavailable,
  );

  return (
    <div data-view="agent" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col border-b border-border">
        <BackButton handle={handle} />
        <div className="flex items-start gap-2.5 px-4 pt-2 pb-3">
          {node && <SubagentGlyph agent={refOf(node)} className="shrink-0 text-prose text-accent" />}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-ui font-semibold">{title}</h2>
            <p data-part="agent-meta" className="truncate text-ui-sm text-fg-muted tabular-nums">
              {meta}
            </p>
            <p data-part="dispatched-by" className="truncate text-ui-sm text-fg-muted">
              {SUBAGENTS_COPY.dispatchedBy(sessionTitle)}
            </p>
          </div>
          {node?.status === 'running' && ctx.status !== null && <StopAgent key={node.taskId} appSessionId={appSessionId} node={node} title={title} />}
        </div>
      </header>
      <Transcript key={source.key ?? agentId} source={source} variant="child" actions={actions} renderRequest={renderRequest} className="min-h-0 flex-1" />
      <RelayComposer appSessionId={appSessionId} agentId={agentId} node={node} status={ctx.status} sessionTitle={sessionTitle} visible={ctx.visible} draft={draft} onDraft={handle.setDraft} onSent={() => handle.clearDraftFor(agentId)} />
    </div>
  );
}

const ACTION = 'shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

// A running agent's stop is irreversible, so it asks first (Codex confirms it); the node reads stopping until the
// engine's terminal frame, and a refused call says why.
function StopAgent({ appSessionId, node, title }: { appSessionId: AppSessionId; node: TaskNode; title: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = () => {
    setOpen(false);
    setError(null);
    void useTaskGraph
      .getState()
      .stop(appSessionId, node.taskId)
      .then((result) => {
        if (!result.ok) setError(result.message);
      });
  };
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {node.stopping ? (
        <button type="button" disabled className={ACTION}>
          {SUBAGENTS_COPY.stopping}
        </button>
      ) : (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" className={ACTION}>
              {SUBAGENTS_COPY.stopAgent}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} collisionPadding={8} className="z-50 flex w-60 flex-col gap-2 rounded-md border border-border-strong bg-bg-overlay p-3 text-ui text-fg">
              <p>{SUBAGENTS_COPY.stopConfirm(title)}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className={ACTION}>
                  {SUBAGENTS_COPY.stopConfirmNo}
                </button>
                <button type="button" onClick={stop} className={`${ACTION} text-danger`}>
                  {SUBAGENTS_COPY.stopConfirmYes}
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {error !== null && <p className="max-w-48 text-right text-ui-sm text-danger">{SUBAGENTS_COPY.stopFailed(error)}</p>}
    </div>
  );
}

// A selection by tool use before `subagent.started` (or the sidecar) names the agent: it becomes the drill-in once one
// does.
export function PendingAgent({ appSessionId, toolUseId, handle }: { appSessionId: AppSessionId; toolUseId: ToolUseId; handle: SubagentsHandle }) {
  const resolved = useTaskGraph((s) => agentOfToolUse(s.entries.get(appSessionId), toolUseId));
  useEffect(() => {
    if (resolved !== null) handle.resolvePending(toolUseId, resolved);
  }, [handle, toolUseId, resolved]);
  return (
    <div data-view="pending" className="flex h-full min-h-0 flex-col">
      <BackButton handle={handle} />
      <p className="flex flex-1 items-center justify-center p-4 text-ui text-fg-muted">{SUBAGENTS_COPY.waitingToStart}</p>
    </div>
  );
}
