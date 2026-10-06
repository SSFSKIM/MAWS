// What the `/plugins` sections share (E8 execution document, M2): the CLI's environment, the widget's operations by
// key, `ask` (which opens the confirm sheet; nothing runs before it is confirmed), and a row's operation line. The sheet
// is drawn beside the widget frame rather than inside a row, so it survives the row leaving the list and its Escape
// closes only the sheet.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { displayTitle } from '../../sessions/title';
import { useSessions } from '../../stores/sessions';
import { PLUGIN_MANAGEMENT as W } from '../copy';
import { TextButton } from '../parts';
import { ConfirmSheet, type Declared, type ManageEnv } from './ConfirmSheet';
import { usePluginOperations, type PluginOperations } from './operation';
import { declaredOf, operationWords, scopeOf, type PluginsRequest } from './present';

export interface Manage {
  env: ManageEnv;
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

type Asking = { key: string; request: PluginsRequest; declared: Declared | null };

// The widget's management state and the sheet to draw beside its frame.
// `resolveEngine`: reads `plugins.env` again, passed while it is unresolved, so a sheet opened after the owner installed
// the engine or chose one in Settings › Engine recovers without reopening the widget.
export function useManageState(env: ManageEnv, reloadMods: (() => void) | null, resolveEngine: (() => void) | null): { manage: Manage; sheet: ReactNode } {
  const ops = usePluginOperations();
  const [asking, setAsking] = useState<Asking | null>(null);
  const ask = useCallback(
    (key: string, request: PluginsRequest) => {
      resolveEngine?.();
      setAsking({ key, request, declared: null });
    },
    [resolveEngine],
  );
  const { run } = ops;
  const confirm = useCallback(
    async (key: string, request: PluginsRequest) => {
      setAsking(null);
      const done = await run(key, request, env.cwd);
      const declared = declaredOf(done, request.action);
      if (declared) setAsking({ key, request: { ...request, input: { ...request.input, acceptCommand: declared.sha256 } } as PluginsRequest, declared });
    },
    [run, env.cwd],
  );
  const manage = useMemo(() => ({ env, ops, ask, reloadMods }), [env, ops, ask, reloadMods]);
  const sheet = asking && (
    <ConfirmSheet key={`${asking.key}:${asking.declared?.sha256 ?? ''}`} request={asking.request} declared={asking.declared} env={env} onConfirm={(request) => void confirm(asking.key, request)} onClose={() => setAsking(null)} />
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
