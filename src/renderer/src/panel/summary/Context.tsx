import type { AppSessionId } from '@shared/graph/ids';
import { FRESHNESS, useObservedFacts } from '../../sessions/observed';
import { openComposerWidget, useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { num } from '../../widgets/parts';
import { FloatingCard } from './FloatingCard';
import { actionClass, ToolButton } from './Section';
import { Sources } from './Sources';

export function Context({ appSessionId, directory }: { appSessionId: AppSessionId; directory: string }) {
  const live = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const sampled = useSessions((s) => s.digests.get(appSessionId)?.context ?? null);
  const observed = useObservedFacts(appSessionId, { enabled: !live }).facts?.contextUsage ?? null;
  const usage = live ? sampled : (observed?.value ?? sampled);
  const hasComposer = useComposerStore((s) => !!s.focusTargets.get(appSessionId)?.openWidget);
  return (
    <FloatingCard title="Context" summary={usage ? `${Math.round(usage.percent)}%${live ? '' : ' · last'}` : 'Not reported'}>
      {usage ? (
        <>
          <p>{num(usage.totalTokens)} of {num(usage.maxTokens)} tokens</p>
          {usage.autoCompactThreshold !== null && <p className="text-ui-sm text-fg-muted">Autocompacts at {num(usage.autoCompactThreshold)} tokens</p>}
          {!live && <p className="text-ui-sm text-fg-muted">{observed ? FRESHNESS.lastReading(observed.at) : 'Last sampled context'}</p>}
        </>
      ) : <p className="text-ui-sm text-fg-muted">{FRESHNESS.notObserved}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={actionClass} disabled={!hasComposer} title={hasComposer ? 'Context breakdown' : 'Open the session to inspect its context'} onClick={() => openComposerWidget(appSessionId, 'context', '')}>Details…</button>
        {/* The existing widget owns compaction's instructions, turn/queue guards and refusal reporting. */}
        <button type="button" className={actionClass} disabled={!hasComposer} title={hasComposer ? 'Open compaction options' : 'Open the session to compact its context'} onClick={() => openComposerWidget(appSessionId, 'compact', '')}>Compact…</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <ToolButton toolId="subagents" label="Subagents" appSessionId={appSessionId} />
        <ToolButton toolId="background" label="Background work" appSessionId={appSessionId} />
      </div>
      <Sources appSessionId={appSessionId} directory={directory} embedded />
    </FloatingCard>
  );
}
