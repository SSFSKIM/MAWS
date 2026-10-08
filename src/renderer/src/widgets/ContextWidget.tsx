// `/context` (C11 execution document, the widget table): `get_context_usage { detail: 'full' }` as the terminal's
// `/context` shows it: `<used> of <max> · <pct>% · autocompact at <threshold>`, a segmented bar of what occupies the
// window with the threshold marked, the categories, and what memory files, MCP tools, agents, commands and skills cost.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetContextUsageResponse } from '@shared/wire/control';
import { openComposerWidget } from '../stores/composer';
import { COMPACT, CONTEXT, SHARED, WIDGET_TITLE } from './copy';
import { Group, KeyValues, num, TextButton } from './parts';
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
  if (!items.success || items.data.length === 0) return SHARED.none;
  return CONTEXT.listed(num(items.data.length), num(items.data.reduce((sum, i) => sum + i.tokens, 0)));
}

function countedCost(value: unknown, total: string, included: string): string | null {
  const parsed = Counted(total, included).safeParse(value);
  if (!parsed.success) return null;
  const d = parsed.data as Record<string, number>;
  return CONTEXT.included(num(d[included]), num(d[total]), num(d.tokens));
}

export function present(usage: GetContextUsageResponse): ContextView {
  const threshold = usage.isAutoCompactEnabled ? (usage.autoCompactThreshold ?? null) : null;
  const share = (n: number) => (usage.maxTokens > 0 ? (n / usage.maxTokens) * 100 : 0);
  const commands = countedCost(usage.slashCommands, 'totalCommands', 'includedCommands');
  const skills = countedCost(usage.skills, 'totalSkills', 'includedSkills');
  return {
    line: CONTEXT.line(num(usage.totalTokens), num(usage.maxTokens), Math.round(usage.percentage), threshold === null ? null : num(threshold)),
    categories: usage.categories.map((c) => ({ name: c.name, tokens: num(c.tokens), note: c.kind === 'deferred' || c.isDeferred === true ? CONTEXT.notInWindow : null })),
    used: usage.categories.filter((c) => c.kind === 'used').map((c) => ({ name: c.name, share: share(c.tokens) })),
    thresholdShare: threshold === null ? null : share(threshold),
    costs: [
      { label: CONTEXT.memoryFiles, value: listCost(usage.memoryFiles) },
      { label: CONTEXT.mcpTools, value: listCost(usage.mcpTools) },
      { label: CONTEXT.agents, value: listCost(usage.agents) },
      ...(commands === null ? [] : [{ label: CONTEXT.commands, value: commands }]),
      ...(skills === null ? [] : [{ label: CONTEXT.skills, value: skills }]),
    ],
  };
}

const SEGMENT = ['bg-fg', 'bg-fg-muted', 'bg-accent', 'bg-fg-faint', 'bg-info'];

export function ContextBody({ view }: { view: ContextView }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0">{view.line}</p>
      <div role="img" aria-label={CONTEXT.bar(view.used.map((u) => u.name).join(', '))} className="relative flex h-2 overflow-hidden rounded-sm bg-bg-active">
        {view.used.map((u, i) => (
          <span key={u.name} title={u.name} className={`h-full shrink-0 border-r border-bg-raised ${SEGMENT[i % SEGMENT.length]}`} style={{ width: `${u.share}%` }} />
        ))}
        {view.thresholdShare !== null && <span aria-hidden className="absolute inset-y-0 w-px bg-warning" style={{ left: `${view.thresholdShare}%` }} />}
      </div>
      <table aria-label={CONTEXT.categories} className="w-full text-ui-sm">
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
      <Group label={CONTEXT.costs}>
        <KeyValues rows={view.costs} />
      </Group>
    </div>
  );
}

export function ContextWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getContextUsage', { appSessionId, detail: 'full' });
  // Compact… hands over to the compact widget over the same composer (C11's seam in C7's composer store)
  const compact = () => {
    close();
    openComposerWidget(appSessionId, 'compact', '');
  };
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.context} command="context" state={read.state} error={read.error} close={close}>
      {read.data && (
        <>
          <ContextBody view={present(read.data)} />
          <p className="m-0 mt-2">
            <TextButton onClick={compact}>{COMPACT.open}</TextButton>
          </p>
        </>
      )}
    </WidgetFrame>
  );
}
