// Settings › Engine's memory budget rows (C12 execution document, Interfaces "Settings, version 4" and "Surfaces of the
// budget"; charter §4.4 as amended by D1): the budget in GB with one decimal (stored in MiB; empty is the default, 25%
// of physical memory), and the MCP servers whose state dies with their process, by name as system/init reports them.
// Each writes its one field through `settings.set`; main pushes the policy to the engine host.
import { useId, useState, type KeyboardEvent } from 'react';
import type { Settings } from '@shared/ipc/schema';
import { useBudget } from '../budget/store';
import { gb } from '../budget/copy';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { Chip, INPUT, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';
import { BUDGET_SETTINGS } from './copy';

const MIN_GB = 0.5; // the schema's 512 MiB

// A GB figure as typed (one decimal shown; any the owner types is taken) into the stored MiB, or null when it is not one.
export function mibOfGb(text: string): number | null {
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < MIN_GB) return null;
  return Math.round(value * 1024);
}

export const gbOfMib = (mib: number): string => (mib / 1024).toFixed(1);

export function MemoryBudget({ settings }: { settings: Settings }) {
  const saved = settings.engine.memoryBudgetMiB;
  const limitKiB = useBudget((s) => s.state?.limitKiB ?? null);
  const [, field] = useCommittedDraft(saved === null ? null : gbOfMib(saved), async (next) => {
    if (next === null) return writeSettings({ engine: { memoryBudgetMiB: null } });
    const mib = mibOfGb(next);
    if (mib === null) {
      toast({ level: 'warning', text: BUDGET_SETTINGS.invalid, actions: [], dismissible: true });
      return false;
    }
    return writeSettings({ engine: { memoryBudgetMiB: mib } });
  });
  // While the setting is the default, the host's limit is that default (main pushes it); once set, it is the setting.
  const fallback = saved === null && limitKiB !== null ? gb(limitKiB) : null;
  return (
    <Setting label={BUDGET_SETTINGS.budget} note={saved === null ? BUDGET_SETTINGS.defaultNote(fallback) : BUDGET_SETTINGS.setNote}>
      <input aria-label={BUDGET_SETTINGS.budget} inputMode="decimal" placeholder={fallback === null ? BUDGET_SETTINGS.placeholder : fallback.replace(' GB', '')} {...field} className={`${INPUT} max-w-[90px] tabular-nums`} />
      <span className="text-ui-sm text-fg-muted">GB</span>
      {saved !== null && (
        <button type="button" className={TEXT_ACTION} onClick={() => void writeSettings({ engine: { memoryBudgetMiB: null } })}>
          {BUDGET_SETTINGS.useDefault}
        </button>
      )}
    </Setting>
  );
}

// The server names live sessions report, for the add field's suggestions.
const useSeenServers = (): string[] =>
  useSessions((s) => {
    const names = new Set<string>();
    for (const status of s.engine.values()) for (const server of status.mcpServers) names.add(server.name);
    return [...names].sort().join('\n');
  })
    .split('\n')
    .filter(Boolean);

export function StatefulServers({ settings }: { settings: Settings }) {
  const list = useId();
  const names = settings.engine.statefulMcpServers;
  const [draft, setDraft] = useState('');
  const seen = useSeenServers().filter((name) => !names.includes(name));
  const write = (next: string[]) => writeSettings({ engine: { statefulMcpServers: next } });
  const add = () => {
    const name = draft.trim();
    if (name === '' || names.includes(name)) return setDraft('');
    void write([...names, name]).then((ok) => ok && setDraft(''));
  };
  return (
    <Setting label={BUDGET_SETTINGS.stateful} note={BUDGET_SETTINGS.statefulNote}>
      {names.map((name) => (
        <Chip key={name}>
          <span className="font-mono">{name}</span>
          <button type="button" aria-label={BUDGET_SETTINGS.remove(name)} className="ml-1 text-fg-muted hover:text-fg" onClick={() => void write(names.filter((n) => n !== name))}>
            ×
          </button>
        </Chip>
      ))}
      <input
        role="combobox"
        aria-label={BUDGET_SETTINGS.addServer}
        list={list}
        placeholder={BUDGET_SETTINGS.addPlaceholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') add();
          if (e.key === 'Escape') setDraft('');
        }}
        className={`${INPUT} max-w-[220px] font-mono`}
      />
      <datalist id={list}>
        {seen.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </Setting>
  );
}
