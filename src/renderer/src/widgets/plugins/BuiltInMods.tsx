// "MAWS mods · Built in", the last group of My items (X20; the P2-C document, §9 and G7; the P2-B execution document
// §5.12). P2-B owns the mount and P2-C this content (the architect's ruling, the interface ledger §6, 2026-10-09): MAWS's
// own default, disableable mods in a session's plugin library, one row per registry entry in the library's row: its name,
// description and version; how its instructions reach this session, in words; the app's switch; this session's override
// (Default, On, Off); what a change still waits for, and the style mismatch. No overflow and no Uninstall: the registry
// is MAWS's, never the engine's. Hidden while the registry is empty or no row matches the library's search. A registry
// main cannot read says so, in main's words.
import type { AppSessionId } from '@shared/graph/ids';
import { Segment } from '../../settings-tab/parts';
import { REPORT } from '../../owner/report/copy';
import { LIBRARY as L } from '../copy';
import { useBuiltInMods } from './builtin-mods';
import { Switch } from './manage';
import { GroupHeading, PluginTile } from './PluginRow';

export function BuiltInMods({ appSessionId, search }: { appSessionId: AppSessionId; search: string }) {
  const { read, failure, setEnabled, setOverride } = useBuiltInMods(appSessionId);
  if (read.state === 'loading') return null;
  if (read.state === 'unavailable')
    return (
      <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
        <GroupHeading label={L.group.builtIn} />
        <p role="status" data-mods-unavailable="" className="m-0 px-2 py-2 text-ui-sm text-fg-muted [overflow-wrap:anywhere]">
          {L.mod.unavailable(read.reason)}
        </p>
      </section>
    );
  const needle = search.trim().toLowerCase();
  const rows = read.rows.filter((row) => needle === '' || `${row.name} ${row.description}`.toLowerCase().includes(needle));
  if (rows.length === 0) return null;
  return (
    <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
      <GroupHeading label={L.group.builtIn} count={rows.length} />
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <li key={row.id} data-mod-row={row.id} className="flex items-start gap-3 border-b border-border px-2 py-2 last:border-b-0">
            <PluginTile />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-ui-sm text-fg-muted">
              <span className="flex min-w-0 items-center gap-2 text-ui">
                <span className="truncate font-medium text-fg">{row.name}</span>
                <span className="shrink-0 rounded-sm bg-bg-active px-1.5 text-ui-sm text-fg-muted">{L.builtIn}</span>
              </span>
              <span>{row.description}</span>
              <span data-mod-source={row.source}>{L.mod.source[row.source]}</span>
              {row.perSession !== undefined && (
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{L.mod.session}</span>
                  <Segment label={L.mod.sessionOverride(row.name)} value={row.perSession} options={L.mod.override(row.enabled)} onChange={(value) => void setOverride(row.id, value)} />
                </span>
              )}
              {row.pending !== undefined && <span data-mod-pending={row.pending}>{L.mod.pending[row.pending]}</span>}
              {row.mismatch !== undefined && <span role="note">{REPORT.mismatch(row.mismatch.observed, row.mismatch.resolved)}</span>}
              {failure !== null && (
                <span role="alert" className="text-danger [overflow-wrap:anywhere]">
                  {L.mod.refused(failure)}
                </span>
              )}
            </div>
            <span className="shrink-0 text-ui-sm text-fg-muted tabular-nums">{L.mod.version(row.version)}</span>
            <Switch checked={row.enabled} label={L.mod.appSwitch(row.name)} disabled={false} onClick={() => void setEnabled(row.id, !row.enabled)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
