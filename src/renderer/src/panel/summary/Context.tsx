import type { AppSessionId } from '@shared/graph/ids';
import { FRESHNESS, useObservedFacts } from '../../sessions/observed';
import { openComposerWidget, useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { num } from '../../widgets/parts';
import { FloatingCard, type CardFold } from './FloatingCard';
import { actionClass } from './Section';
import { Sources, useHasSources } from './Sources';

// UX wave U8b (O-10): Details… alone under the figures (compaction is the composer's /compact, and running work has its
// own cards), and a Sources part only while there is a source to list. The word cut: a session that reported nothing
// leaves the heading's summary empty (P52) and the figure a dash (P174); a session not running says how old its reading
// is, "as of 2h ago", and nothing when that is not known (P55).
export function Context({ appSessionId, directory, fold }: { appSessionId: AppSessionId; directory: string; fold: CardFold }) {
  const live = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const sampled = useSessions((s) => s.digests.get(appSessionId)?.context ?? null);
  const observed = useObservedFacts(appSessionId, { enabled: !live }).facts?.contextUsage ?? null;
  const usage = live ? sampled : (observed?.value ?? sampled);
  const hasComposer = useComposerStore((s) => !!s.focusTargets.get(appSessionId)?.openWidget);
  return (
    <FloatingCard title="Context" summary={usage ? `${Math.round(usage.percent)}%${live ? '' : ' · last'}` : null} {...fold}>
      {usage ? (
        <>
          <p>{num(usage.totalTokens)} of {num(usage.maxTokens)} tokens</p>
          {usage.autoCompactThreshold !== null && <p className="text-ui-sm text-fg-muted">Autocompacts at {num(usage.autoCompactThreshold)} tokens</p>}
          {!live && observed && <p className="text-ui-sm text-fg-muted">{FRESHNESS.asOf(observed.at)}</p>}
        </>
      ) : <p className="text-ui-sm text-fg-muted">{FRESHNESS.unknown}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={actionClass} disabled={!hasComposer} title={hasComposer ? 'Context breakdown' : 'Open the session to inspect its context'} onClick={() => openComposerWidget(appSessionId, 'context', '')}>Details…</button>
      </div>
      <SourcesPart appSessionId={appSessionId} directory={directory} />
    </FloatingCard>
  );
}

// Mounted with the opened card only, so a folded card reads nothing of the transcript's sources.
function SourcesPart({ appSessionId, directory }: { appSessionId: AppSessionId; directory: string }) {
  return useHasSources(appSessionId) ? <Sources appSessionId={appSessionId} directory={directory} embedded /> : null;
}
