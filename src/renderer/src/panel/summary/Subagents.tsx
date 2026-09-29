// Subagents (C8 spec *The summary*): the children's glyphs as the transcript draws them (C6's `SubagentGlyph` over the
// activity's refs, running before finished, four at most) and `N working · M done` from the session's digest; "Open"
// opens the Subagents tool. A registered Subagents tool's own summary replaces this baseline.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../../stores/sessions';
import { SubagentGlyph } from '../../transcript';
import { SUMMARY_COPY } from '../copy';
import { agentGlyphs } from './derive';
import { Row, Section, ToolButton, ToolSummary, useToolSummary } from './Section';
import { useSessionActivity } from './Sources';

export function Subagents({ appSessionId }: { appSessionId: AppSessionId }) {
  const custom = useToolSummary('subagents');
  return <Section id="subagents">{custom ? <ToolSummary toolId="subagents" appSessionId={appSessionId} component={custom} /> : <Baseline appSessionId={appSessionId} />}</Section>;
}

function Baseline({ appSessionId }: { appSessionId: AppSessionId }) {
  const counts = useSessions((s) => s.digests.get(appSessionId)?.childAgents);
  const activity = useSessionActivity(appSessionId);
  const glyphs = useMemo(() => (activity ? agentGlyphs(activity) : []), [activity]);
  const any = counts !== undefined && (counts.active > 0 || counts.done > 0);
  const countLine = any ? SUMMARY_COPY.agents(counts.active, counts.done) : glyphs.length === 0 ? SUMMARY_COPY.noAgents : null;
  const open = <ToolButton toolId="subagents" label={SUMMARY_COPY.open} appSessionId={appSessionId} />;
  if (glyphs.length === 0) {
    return (
      <Row action={open}>
        <span className="block truncate">{countLine}</span>
      </Row>
    );
  }
  return (
    <>
      <Row action={open}>
        <span data-testid="agent-glyphs" role="img" aria-label={glyphs.map((g) => g.name).join(', ')} className="flex gap-1.5 text-accent">
          {glyphs.map((agent) => (
            <SubagentGlyph key={agent.taskId} agent={agent} />
          ))}
        </span>
      </Row>
      {countLine && <p className="text-ui-sm text-fg-muted">{countLine}</p>}
    </>
  );
}
