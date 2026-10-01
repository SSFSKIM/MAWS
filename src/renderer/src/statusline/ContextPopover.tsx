// The context popover (§5.5; mockup 04 vignette 5; W2: the toolbar's context ring opens it, `ContextRing.tsx`, since the
// status line is gone): `session.getContextUsage { detail: 'full' }` read on open (fresh for 10 s), the digest's
// percentage while it loads; `<used> of <max> · autocompact at <threshold>`, the tokens left
// until compaction, a segmented bar of what occupies the window with the threshold marked, the categories, and
// `Compact now`, which sends `/compact` when the session's catalogue lists it as a headless command.
import type { SessionRecord } from '@shared/graph/session';
import type { GetContextUsageResponse } from '@shared/wire/control';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { useSessionCatalog } from '../stores/catalog';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { tokens } from './format';

const SEGMENT = ['bg-fg', 'bg-fg-muted', 'bg-accent', 'bg-fg-faint', 'bg-info'];

function Breakdown({ usage }: { usage: GetContextUsageResponse }) {
  const threshold = usage.isAutoCompactEnabled ? (usage.autoCompactThreshold ?? null) : null;
  const used = usage.categories.filter((c) => c.kind === 'used');
  const share = (n: number) => (usage.maxTokens > 0 ? (n / usage.maxTokens) * 100 : 0);
  const label = used.map((c) => `${c.name} ${tokens(c.tokens)}`).join(', ');
  return (
    <>
      <p>
        {tokens(usage.totalTokens)} of {tokens(usage.maxTokens)}
        {threshold !== null && ` · autocompact at ${tokens(threshold)}`}
      </p>
      <p className="text-ui-sm text-fg-muted">
        {usage.percentage.toFixed(1)}% used{threshold !== null && ` · ${tokens(Math.max(0, threshold - usage.totalTokens))} until compaction`}
      </p>
      <div role="img" aria-label={`Context breakdown: ${label}${threshold !== null ? `. Autocompact at ${tokens(threshold)}` : ''}`} className="relative flex h-2 overflow-hidden rounded-sm bg-bg-active">
        {used.map((c, i) => (
          <span key={c.name} title={`${c.name}: ${tokens(c.tokens)}`} className={`h-full shrink-0 border-r border-bg-overlay ${SEGMENT[i % SEGMENT.length]}`} style={{ width: `${share(c.tokens)}%` }} />
        ))}
        {threshold !== null && <span aria-hidden className="absolute inset-y-0 w-px bg-warning" style={{ left: `${share(threshold)}%` }} />}
      </div>
      <table aria-label="Context token breakdown" className="w-full text-ui-sm">
        <tbody>
          {usage.categories.map((c) => (
            <tr key={c.name}>
              <td className="py-0.5">
                {c.name}
                {c.kind === 'deferred' && <span className="text-fg-faint"> · not in the window</span>}
              </td>
              <td className="py-0.5 text-right text-fg-muted tabular-nums">{tokens(c.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ContextPopoverBody({ record, close }: { record: SessionRecord; close: () => void }) {
  const id = record.appId;
  const live = useSessions((s) => s.engine.get(id)?.process === 'ready');
  const digest = useSessions((s) => s.digests.get(id)?.context ?? null);
  const usage = useCommand('session.getContextUsage', { appSessionId: id, detail: 'full' }, { enabled: live, staleTime: 10_000 });
  const catalog = useSessionCatalog(live ? id : null);
  const compactable = live && catalog.commands.some((c) => c.name === 'compact') && !catalog.terminalOnly.includes('compact');

  const compact = async () => {
    close();
    const result = await ipc.invoke('session.send', { appSessionId: id, content: '/compact' });
    if (!result.ok) toast({ level: 'warning', text: `Compact did not start: ${result.error.message}`, actions: [], dismissible: true });
  };

  let body;
  if (usage.data) body = <Breakdown usage={usage.data} />;
  else if (digest) body = <p className="text-fg-muted">{Math.round(digest.percent)}% of {tokens(digest.maxTokens)} used</p>;
  else body = <p className="text-fg-muted">{live ? 'Reading the context window…' : 'No context reading: the session is not running'}</p>;

  return (
    <div className="flex flex-col gap-2.5 p-3.5">
      <h3 className="font-semibold">Context window</h3>
      {body}
      {usage.isError && digest === null && <p className="text-ui-sm text-fg-muted">{usage.error.message}</p>}
      {compactable && (
        <button type="button" onClick={() => void compact()} className="self-start rounded-sm border border-border-strong px-2 py-0.5 outline-accent hover:bg-bg-hover focus-visible:outline-2">
          Compact now
        </button>
      )}
    </div>
  );
}
