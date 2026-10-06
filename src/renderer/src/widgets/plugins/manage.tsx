// What the `/plugins` sections share (E8 execution document, M2): the CLI's environment, the widget's operations by
// key, `ask` (which opens the confirm sheet; nothing runs before it is confirmed), and a row's operation line. The sheet
// is drawn beside the widget frame rather than inside a row, so it survives the row leaving the list and its Escape
// closes only the sheet.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { displayTitle } from '../../sessions/title';
import { useSessions } from '../../stores/sessions';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { TextButton } from '../parts';
import { ConfirmSheet, type Declared, type EngineResolution } from './ConfirmSheet';
import { usePluginOperations, type PluginOperations } from './operation';
import { declaredOf, operationWords, scopeOf, type PluginsRequest } from './present';

export interface Manage {
  cwd: string; // the session's directory, where a change runs unless its request names another project
  ops: PluginOperations;
  ask(key: string, request: PluginsRequest): void; // opens the confirm sheet for the row `key`
  reloadMods: (() => void) | null; // `session.reloadPlugins` for this session; null without a ready process
}

const ManageContext = createContext<Manage | null>(null);

export function useManage(): Manage {
  const manage = useContext(ManageContext);
  if (manage === null) throw new Error('useManage outside the plugins widget');
  return manage;
}

export const ManageProvider = ({ value, children }: { value: Manage; children: ReactNode }) => <ManageContext.Provider value={value}>{children}</ManageContext.Provider>;

// One open sheet: the row and request it asks about, the marketplace-declared command of a second sheet, and the
// engine as this opening read it (`loading` until that read answered).
type Asking = { key: string; request: PluginsRequest; declared: Declared | null; engine: EngineResolution; opening: number };

// The widget's management state and the sheet to draw beside its frame. `resolveEngine` reads `plugins.env` again: every
// opening of a sheet asks it and the sheet names no binary and confirms nothing until it answered, so a binary chosen in
// Settings › Engine since the widget opened is the one the sheet shows and the host runs (E8 whole-branch review).
export function useManageState(base: { cwd: string; readySessions: number }, reloadMods: (() => void) | null, resolveEngine: () => Promise<EngineResolution>): { manage: Manage; sheet: ReactNode } {
  const ops = usePluginOperations();
  const [asking, setAsking] = useState<Asking | null>(null);
  const openings = useRef(0);
  const open = useCallback(
    (key: string, request: PluginsRequest, declared: Declared | null) => {
      const opening = ++openings.current;
      setAsking({ key, request, declared, engine: { state: 'loading' }, opening });
      void resolveEngine().then((engine) => setAsking((current) => (current?.opening === opening ? { ...current, engine } : current)));
    },
    [resolveEngine],
  );
  const ask = useCallback((key: string, request: PluginsRequest) => open(key, request, null), [open]);
  const { run } = ops;
  const { cwd, readySessions } = base;
  const confirm = useCallback(
    async (key: string, request: PluginsRequest, binary: string) => {
      setAsking(null);
      const done = await run(key, request, request.cwd ?? cwd, binary);
      const declared = declaredOf(done, request.action);
      if (declared) open(key, { ...request, input: { ...request.input, acceptCommand: declared.sha256 } } as PluginsRequest, declared);
    },
    [run, cwd, open],
  );
  const manage = useMemo(() => ({ cwd, ops, ask, reloadMods }), [cwd, ops, ask, reloadMods]);
  const sheet = asking && (
    <ConfirmSheet
      key={`${asking.key}:${asking.opening}`}
      request={asking.request}
      declared={asking.declared}
      env={{ cwd, readySessions, engine: asking.engine }}
      onConfirm={(request, binary) => void confirm(asking.key, request, binary)}
      onClose={() => setAsking(null)}
    />
  );
  return { manage, sheet };
}

const titleOf = (appSessionId: string): string => {
  const record = useSessions.getState().records.get(appSessionId as AppSessionId);
  return record ? displayTitle(record) : appSessionId;
};

// A row's operation: `Working…`, the CLI's progress, the engine's result or failure with the reload report; Stop while
// the CLI runs, and Reload again when a session did not reflect the change.
export function OperationLine({ opKey, label }: { opKey: string; label?: string }) {
  const { ops, reloadMods } = useManage();
  const entry = ops.entries.get(opKey);
  const words = entry ? operationWords(entry.state, titleOf, scopeOf(entry.request)) : null;
  if (!entry || words === null) return null;
  const stoppable = entry.state.phase === 'working' && entry.opId !== null && !entry.state.reloading;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span role="status" aria-label={label} className={`min-w-0 whitespace-pre-line [overflow-wrap:anywhere] ${words.failed ? 'text-danger' : 'text-fg-muted'}`}>
        {words.text}
      </span>
      {stoppable && <TextButton onClick={() => ops.cancel(opKey)}>{W.cancel}</TextButton>}
      {words.reloadAgain && reloadMods && <TextButton onClick={reloadMods}>{W.reloadAgain}</TextButton>}
    </span>
  );
}

// The result of a change whose row has left the list (an uninstall, a removed marketplace), under its name.
export function Gone({ opKey, name, data }: { opKey: string; name: string; data: { [attribute: `data-${string}`]: string } }) {
  return (
    <div {...data} className="flex min-w-0 items-baseline gap-2 border-t border-border py-1 text-ui-sm">
      <span className="shrink-0">{name}</span>
      <OperationLine opKey={opKey} />
    </div>
  );
}

// A switch in the MCP widget's shape (`role="switch"`): its position is the last read's, never an outcome's.
const SWITCH = 'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-border outline-accent focus-visible:outline-2 disabled:opacity-50';
export function Switch({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled: boolean; onClick(): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick} className={`${SWITCH} ${checked ? 'bg-accent' : 'bg-bg-active'}`}>
      <span aria-hidden className={`absolute size-3 rounded-full bg-bg-raised ${checked ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  );
}
