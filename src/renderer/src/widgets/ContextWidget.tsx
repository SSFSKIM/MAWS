// `/context` (C11 execution document, the widget table): `get_context_usage { detail: 'full' }` as the terminal's
// `/context` shows it: `<used> of <max> · <pct>% · autocompact at <threshold>`, a segmented bar of what occupies the
// window with the threshold marked, the categories, and what memory files, MCP tools, agents, commands and skills cost.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetContextUsageResponse } from '@shared/wire/control';
import { NOT_IN_WINDOW, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Group, KeyValues, num } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const Costed = z.array(z.looseObject({ tokens: z.number() }));
const Counted = (total: string, included: string) => z.looseObject({ [total]: z.number(), [included]: z.number(), tokens: z.number() });

export interface ContextView {
  line: string;
  categories: { name: string; tokens: string; note: string | null }[];
  used: { name: string; share: number }[]; // the bar's segments, percent of the window
  thresholdShare: number | null;
  costs: { label: string; value: string }[];
}

function listCost(value: unknown): string {
  const items = Costed.safeParse(value);
  if (!items.success || items.data.length === 0) return 'none';
  return `${items.data.length} · ${num(items.data.reduce((sum, i) => sum + i.tokens, 0))} tokens`;
}

function countedCost(value: unknown, total: string, included: string): string | null {
  const parsed = Counted(total, included).safeParse(value);
  if (!parsed.success) return null;
  const d = parsed.data as Record<string, number>;
  return `${num(d[included])} of ${num(d[total])} · ${num(d.tokens)} tokens`;
}

export function present(usage: GetContextUsageResponse): ContextView {
  const threshold = usage.isAutoCompactEnabled ? (usage.autoCompactThreshold ?? null) : null;
  const share = (n: number) => (usage.maxTokens > 0 ? (n / usage.maxTokens) * 100 : 0);
  const commands = countedCost(usage.slashCommands, 'totalCommands', 'includedCommands');
  const skills = countedCost(usage.skills, 'totalSkills', 'includedSkills');
  return {
    line: `${num(usage.totalTokens)} of ${num(usage.maxTokens)} · ${Math.round(usage.percentage)}% · ${threshold === null ? 'autocompact off' : `autocompact at ${num(threshold)}`}`,
    categories: usage.categories.map((c) => ({ name: c.name, tokens: num(c.tokens), note: c.kind === 'deferred' || c.isDeferred === true ? NOT_IN_WINDOW : null })),
    used: usage.categories.filter((c) => c.kind === 'used').map((c) => ({ name: c.name, share: share(c.tokens) })),
    thresholdShare: threshold === null ? null : share(threshold),
    costs: [
      { label: 'Memory files', value: listCost(usage.memoryFiles) },
      { label: 'MCP tools', value: listCost(usage.mcpTools) },
      { label: 'Agents', value: listCost(usage.agents) },
      ...(commands === null ? [] : [{ label: 'Commands', value: commands }]),
      ...(skills === null ? [] : [{ label: 'Skills', value: skills }]),
    ],
  };
}

const SEGMENT = ['bg-fg', 'bg-fg-muted', 'bg-accent', 'bg-fg-faint', 'bg-info'];

export function ContextBody({ view }: { view: ContextView }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0">{view.line}</p>
      <div role="img" aria-label={`Context: ${view.used.map((u) => u.name).join(', ')}`} className="relative flex h-2 overflow-hidden rounded-sm bg-bg-active">
        {view.used.map((u, i) => (
          <span key={u.name} title={u.name} className={`h-full shrink-0 border-r border-bg-raised ${SEGMENT[i % SEGMENT.length]}`} style={{ width: `${u.share}%` }} />
        ))}
        {view.thresholdShare !== null && <span aria-hidden className="absolute inset-y-0 w-px bg-warning" style={{ left: `${view.thresholdShare}%` }} />}
      </div>
      <table aria-label="Context categories" className="w-full text-ui-sm">
        <tbody>
          {view.categories.map((c) => (
            <tr key={c.name}>
              <td className="py-0.5">
                {c.name}
                {c.note && <span className="text-fg-faint"> · {c.note}</span>}
              </td>
              <td className="py-0.5 text-right text-fg-muted tabular-nums">{c.tokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Group label="What loads with every request">
        <KeyValues rows={view.costs} />
      </Group>
    </div>
  );
}

export function ContextWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getContextUsage', { appSessionId, detail: 'full' });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.context} command="context" foot={WIDGET_FOOT.context} state={read.state} error={read.error} close={close}>
      {read.data && <ContextBody view={present(read.data)} />}
    </WidgetFrame>
  );
}
