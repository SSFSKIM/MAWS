// "MAWS mods · Built in", the last group of My items (X20; P2-B execution document §5.12). P2-C owns this section's
// content and P2-B its mount and its hook (the architect's ruling, the interface ledger §6, 2026-10-09): this is P2-B's
// thin copy, drawing what `useBuiltInMods` answers, which is nothing until P2-C lands and merges its body here. A row:
// the mod's name and description, "Built in", its switch, how the contract reaches the engine when that is the output
// style, and this session's override; no overflow, no Uninstall (no engine CLI can uninstall a built-in mod).
import type { AppSessionId } from '@shared/graph/ids';
import { LIBRARY as L } from '../copy';
import { useBuiltInMods } from './builtin-mods';
import { GroupHeading, PluginTile } from './PluginRow';
import { Switch } from './manage';

export function BuiltInMods({ appSessionId, search }: { appSessionId: AppSessionId; search: string }) {
  const { rows, setEnabled } = useBuiltInMods(appSessionId);
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => needle === '' || `${row.name} ${row.description}`.toLowerCase().includes(needle));
  if (shown.length === 0) return null;
  return (
    <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
      <GroupHeading label={L.group.builtIn} count={shown.length} />
      <ul className="m-0 list-none p-0">
        {shown.map((row) => (
          <li key={row.id} data-mod-row={row.id} className="flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0">
            <PluginTile />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{row.name}</span>
                <span className="shrink-0 rounded-sm bg-bg-active px-1.5 text-ui-sm text-fg-muted">{L.builtIn}</span>
              </span>
              <span className="truncate text-ui-sm text-fg-muted">{row.description}</span>
              {row.source === 'external-compatible-style' && <span className="text-ui-sm text-fg-muted">{L.throughStyle}</span>}
              {(row.perSession === 'on' || row.perSession === 'off') && <span className="text-ui-sm text-fg-muted">{L.thisSession(row.perSession === 'on')}</span>}
            </div>
            <Switch checked={row.enabled} label={L.modSwitch(row.name)} disabled={setEnabled === null} onClick={() => void setEnabled?.(row.id, !row.enabled)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
