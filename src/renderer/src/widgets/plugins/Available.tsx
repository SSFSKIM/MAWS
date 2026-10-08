// Available (E8 execution document, M2; D-7, D-12): closed by default, and only its opening issues the
// `claude plugin list --json --available` read, since that listing refreshes the engine's catalogue cache. Inside, a
// filter and, per marketplace, a collapsed group `<marketplace> · N plugins` whose rows (drawn only while it is open:
// the built-in directory alone lists hundreds) offer Install…; the built-in directory is listed like any other. An install
// whose plugin the next read no longer offers keeps its result beneath the groups (M3: the widgets gate). The engine's
// listing leaves installed plugins out (2.1.291), so no row is marked installed here.
import { useMemo, useState } from 'react';
import type { AvailablePlugin } from '@shared/ipc/schema/plugins';
import { FRAME, PLUGIN_MANAGEMENT as W } from '../copy';
import { Row, Rows, TextButton } from '../parts';
import { Gone, OperationLine, useManage } from './manage';
import { availableGroups, requestFor, type AvailableGroup } from './present';
import { usePluginsRead } from './read';

const PREFIX = 'available:';
const availableKey = (id: string) => `${PREFIX}${id}`;

function AvailableRow({ plugin }: { plugin: AvailablePlugin }) {
  const { ops, ask } = useManage();
  const key = availableKey(plugin.pluginId);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  return (
    <Row
      data-plugin-row={plugin.pluginId}
      main={plugin.name}
      note={plugin.version ?? undefined}
      detail={
        <span className="flex flex-col gap-0.5">
          {plugin.description && <span className="line-clamp-2">{plugin.description}</span>}
          <OperationLine opKey={key} />
        </span>
      }
      actions={
        <TextButton onClick={() => ask(key, requestFor('install', { plugin: plugin.pluginId, scope: 'user' }, null))} disabled={busy}>
          {W.install}
        </TextButton>
      }
    />
  );
}

function MarketplaceGroup({ group, filtering }: { group: AvailableGroup; filtering: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={filtering || undefined} onToggle={(event) => setOpen(event.currentTarget.open)} className="mt-1">
      <summary className="cursor-default text-ui-sm text-fg">{W.availableIn(group.marketplace, group.plugins.length)}</summary>
      {(open || filtering) && (
        <Rows label={W.availableList(group.marketplace)}>
          {group.plugins.map((plugin) => (
            <AvailableRow key={plugin.pluginId} plugin={plugin} />
          ))}
        </Rows>
      )}
    </details>
  );
}

export function AvailableSection({ cwd }: { cwd: string }) {
  // the read runs only while the section is open: its opening reads (again, once the last answer is 10 s old), and a
  // change rereads it only then; a collapsed section keeps its last answer
  const { ops } = useManage();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const read = usePluginsRead('plugins.available', cwd, open);
  const plugins = read.data?.plugins;
  const groups = useMemo(() => availableGroups(plugins ?? [], filter), [plugins, filter]);
  const filtering = filter.trim() !== '';
  const listed = new Set((plugins ?? []).map((p) => availableKey(p.pluginId)));
  const gone = plugins ? [...ops.entries.keys()].filter((key) => key.startsWith(PREFIX) && !listed.has(key)) : [];
  return (
    <section data-plugins-section="available" aria-label={W.available} className="mt-3">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="cursor-default text-ui-sm font-semibold tracking-wide text-fg-muted uppercase">
          {W.available}
          {plugins && <span className="ml-1.5 font-normal">{plugins.length}</span>}
        </summary>
        {open && (
          <div className="mt-1 flex flex-col gap-1">
            {read.state === 'loading' && <p className="m-0 text-ui-sm text-fg-muted">{FRAME.reading}</p>}
            {read.error !== null && <p className={`m-0 text-ui-sm ${plugins ? 'text-warning' : 'text-danger'}`}>{read.error}</p>}
            {plugins && (
              <>
                <input
                  aria-label={W.filterPlaceholder}
                  placeholder={W.filterPlaceholder}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="rounded-sm border border-border bg-bg px-2 py-0.5 text-ui-sm outline-accent focus-visible:outline-2"
                />
                {plugins.length === 0 ? (
                  <p className="m-0 text-ui-sm text-fg-muted">{W.noAvailable}</p>
                ) : groups.length === 0 ? (
                  <p className="m-0 text-ui-sm text-fg-muted">{W.noMatch}</p>
                ) : (
                  groups.map((group) => <MarketplaceGroup key={group.marketplace} group={group} filtering={filtering} />)
                )}
                {gone.map((key) => (
                  <Gone key={key} opKey={key} name={key.slice(PREFIX.length)} data={{ 'data-plugin-result': key.slice(PREFIX.length) }} />
                ))}
              </>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
