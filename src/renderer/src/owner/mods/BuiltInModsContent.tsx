// "MAWS mods · Built in" (X20; the P2-C document, §9 and G7): MAWS's own default, disableable mods in a session's plugin
// surface, one row per registry entry: its name, description and version; how its instructions reach this session, in
// words; the app's switch; this session's override (Default, On, Off); what a change still waits for, and the style
// mismatch. No Uninstall: the registry is MAWS's, never the engine's. Hidden while the registry is empty (or no row
// matches the search). A registry main cannot read says so, in main's words. P2-C owns this content and P2-B the
// section's mount in its library (the architect's ruling, 2026-10-10); until both have landed, `/plugins` mounts it
// under its existing sections.
import type { AppSessionId } from '@shared/graph/ids';
import type { ModRow } from '@shared/mods/registry';
import type { LaneOverride } from '@shared/owner/state';
import { Segment } from '../../settings-tab/parts';
import { Group, Row, Rows } from '../../widgets/parts';
import { Switch } from '../../widgets/plugins/manage';
import { REPORT } from '../report/copy';
import { useModRows } from './use-mod-rows';

export const MODS = {
  group: 'MAWS mods · Built in',
  builtIn: 'Built in',
  version: (n: number) => `Version ${n}`,
  unavailable: (reason: string) => `MAWS mods can’t be read right now: ${reason}`,
  appSwitch: (name: string) => `${name} in every session`,
  session: 'This session',
  override: (appOn: boolean): { value: LaneOverride; label: string }[] => [
    { value: 'inherit', label: `Default (${appOn ? 'On' : 'Off'})` },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ],
  source: {
    'maws-contract': 'MAWS gives the agent its instructions',
    'external-compatible-style': 'The output style gives the agent its instructions',
    off: 'Off',
  } satisfies Record<ModRow['source'], string>,
  pending: {
    'next-launch': 'Applies the next time this session starts',
    'next-compaction': 'Applies after this session’s next compaction',
  } satisfies Record<NonNullable<ModRow['pending']>, string>,
};

export function BuiltInModsContent({ appSessionId, search = '' }: { appSessionId: AppSessionId; search?: string }) {
  const { read, setEnabled, setOverride } = useModRows(appSessionId);
  if (read.state === 'loading') return null;
  if (read.state === 'unavailable')
    return (
      <Group label={MODS.group}>
        <p role="status" data-mods-unavailable="" className="m-0 text-ui-sm text-fg-muted">
          {MODS.unavailable(read.reason)}
        </p>
      </Group>
    );
  const needle = search.trim().toLowerCase();
  const rows = read.rows.filter((row) => needle === '' || `${row.name} ${row.description}`.toLowerCase().includes(needle));
  if (rows.length === 0) return null;
  return (
    <Group label={MODS.group} count={rows.length}>
      <Rows label={MODS.group}>
        {rows.map((row) => (
          <Row
            key={row.id}
            data-mod-row={row.id}
            main={
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{row.name}</span>
                <span className="rounded-sm bg-bg-active px-1.5 text-ui-sm text-fg-muted">{MODS.builtIn}</span>
                <span className="text-fg-muted">{MODS.version(row.version)}</span>
              </span>
            }
            actions={<Switch checked={row.enabled} label={MODS.appSwitch(row.name)} disabled={false} onClick={() => void setEnabled(row.id, !row.enabled)} />}
            detail={
              <span className="flex flex-col gap-1">
                <span>{row.description}</span>
                <span data-mod-source={row.source}>{MODS.source[row.source]}</span>
                {row.perSession !== undefined && (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{MODS.session}</span>
                    <Segment label={`${row.name} in this session`} value={row.perSession} options={MODS.override(row.enabled)} onChange={(value) => void setOverride(row.id, value)} />
                  </span>
                )}
                {row.pending !== undefined && <span data-mod-pending={row.pending}>{MODS.pending[row.pending]}</span>}
                {row.mismatch !== undefined && <span role="note">{REPORT.mismatch(row.mismatch.observed, row.mismatch.resolved)}</span>}
              </span>
            }
          />
        ))}
      </Rows>
    </Group>
  );
}
