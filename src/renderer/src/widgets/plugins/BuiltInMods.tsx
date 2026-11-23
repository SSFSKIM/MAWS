// "Built in", the last group of My items (X20; the P2-C document, §9 and G7; the P2-B execution document §5.12). P2-B
// owns the mount and P2-C this content (the architect's ruling, the interface ledger §6, 2026-10-09): MAWS's own default,
// disableable mods in a session's plugin library, one row per registry entry in the library's row: its name, its Built in
// mark, its version and the app's switch; opening the row, this session's override (Default, On, Off); what a change
// still waits for, and the style mismatch. The word cut (G223, G225, G226; the owner's ruling of 2026-11-20 for the mods
// list and All alike): the head reads "Built in", the description is the row's note (on pointing or focus, the switch's
// description at all times), the line on how its instructions reach the session is gone, and the override waits behind
// opening the row, open from the start where the session overrides the default. No overflow and no Uninstall: the registry
// is MAWS's, never the engine's. Hidden while the registry is empty or no row matches the library's search. A registry
// main cannot read says so, in main's words. UX wave U11c: Customize's My items, All draws the same rows, with no heading,
// after the plugins (customize/MineAll.tsx).
// UX wave U2b (M7; the execution document, §M, "The switch"; frame 11): in the mods list alone, a row that carries
// `summaries` draws a second line, the summaries' switch: its words in one label with the control, so the whole line is
// its hit area and the words are its name; its sentence is the line's own note (the word cut, N149). Customize's All
// passes no such switch and draws the row as before.
import { useState, type MouseEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModRow } from '@shared/mods/registry';
import { Segment } from '../../settings-tab/parts';
import { REPORT } from '../../owner/view/copy'; // UX wave U2b: the view's words
import { ItemImage } from '../../customize/image/ItemImage';
import { RowNote, useRowNote } from '../../ui/row-note';
import { KindWord } from '../../customize/KindWord';
import { LIBRARY as L } from '../copy';
import { useBuiltInMods, type BuiltInModsState, type ModRowsRead } from './builtin-mods';
import { Switch } from './manage';
import { GroupHeading } from './PluginRow';

// The mods a search keeps: by name and description (My items' rule for its mods).
export const modsMatching = (rows: readonly ModRow[], search: string): ModRow[] => {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => needle === '' || `${row.name} ${row.description}`.toLowerCase().includes(needle));
};

export function BuiltInMods({ appSessionId, search }: { appSessionId: AppSessionId | null; search: string }) {
  const mods = useBuiltInMods(appSessionId);
  const { read } = mods;
  if (read.state === 'loading') return null;
  if (read.state === 'unavailable')
    return (
      <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
        <GroupHeading label={L.group.builtIn} />
        <ModsUnavailable read={read} />
      </section>
    );
  const rows = modsMatching(read.rows, search);
  if (rows.length === 0) return null;
  return (
    <section aria-label={L.group.builtIn} data-plugins-group="builtIn">
      <GroupHeading label={L.group.builtIn} count={rows.length} />
      <ul className="m-0 list-none p-0">
        {rows.map((row) => (
          <BuiltInModRow key={row.id} row={row} mods={mods} appSessionId={appSessionId} summariesSwitch />
        ))}
      </ul>
    </section>
  );
}

// A registry main cannot read, in main's words (or why a session on another machine cannot read it from here).
export function ModsUnavailable({ read }: { read: Extract<ModRowsRead, { state: 'unavailable' }> }) {
  return (
    <p role="status" data-mods-unavailable="" className="m-0 px-2 py-2 text-ui-sm text-fg-muted [overflow-wrap:anywhere]">
      {read.elsewhere ? read.reason : L.mod.unavailable(read.reason)}
    </p>
  );
}

// A click on the row (its open button's, by pointer or key, included) opens or closes it unless it landed on a control of
// its own (the switch, the override's choices).
const ownControl = (target: EventTarget): boolean => target instanceof Element && target.closest('button:not([data-row-open]), input, label') !== null;

// One mod's row. UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E): under Customize's All,
// `kindWord` draws "Mod" before the switch. UX wave U2b (M7): `summariesSwitch`, passed by the mods list alone, draws the
// summaries' switch on a second line where the row carries `summaries`. The row's own line and the summaries' line are
// each a row of their own for their notes, so each note floats under the line it belongs to.
export function BuiltInModRow({ row, mods, appSessionId, kindWord = false, summariesSwitch = false }: { row: ModRow; mods: BuiltInModsState; appSessionId: AppSessionId | null; kindWord?: boolean; summariesSwitch?: boolean }) {
  const { failure, setEnabled, setOverride, setFoldSummaries } = mods;
  const summaries = summariesSwitch ? row.summaries : undefined;
  const note = useRowNote();
  const noted = row.description !== '';
  const describedBy = noted ? note.id : undefined;
  const override = appSessionId !== null && row.perSession !== undefined ? row.perSession : null;
  const [opened, setOpened] = useState(override !== null && override !== 'inherit');
  const open = override !== null && opened;
  return (
    <li data-mod-row={row.id} className="border-b border-border last:border-b-0">
      <div
        data-mod-main=""
        {...note.rowProps}
        aria-describedby={describedBy}
        className={`relative flex items-start gap-3 px-2 py-2${override === null ? '' : ' hover:bg-bg-hover'}`}
        onClick={override === null ? undefined : (event: MouseEvent) => {
          if (!ownControl(event.target)) setOpened((was) => !was);
        }}
      >
        {override !== null && <button type="button" data-row-open aria-label={row.name} aria-expanded={open} aria-describedby={describedBy} className="absolute inset-0 rounded-sm outline-accent -outline-offset-2 focus-visible:outline-2" />}
        <ItemImage kind="mod" seed={row.name} iconUrl={null} size="row" />
        <div className="relative flex min-w-0 flex-1 flex-col gap-0.5 text-ui-sm text-fg-muted">
          <span className="flex min-w-0 items-center gap-2 text-ui">
            <span className="truncate font-medium text-fg">{row.name}</span>
            <span className="shrink-0 rounded-sm bg-bg-active px-1.5 text-ui-sm text-fg-muted">{L.builtIn}</span>
          </span>
          {open && override !== null && (
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <span>{L.mod.session}</span>
              <Segment label={L.mod.sessionOverride(row.name)} value={override} options={L.mod.override(row.enabled)} onChange={(value) => void setOverride(row.id, value)} />
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
        {noted && (
          <RowNote note={note} className="pl-14">
            {row.description}
          </RowNote>
        )}
        <span className="relative shrink-0 text-ui-sm text-fg-muted tabular-nums">{L.mod.version(row.version)}</span>
        {kindWord && <KindWord kind="mod" />}
        <Switch checked={row.enabled} label={L.mod.appSwitch(row.name)} disabled={false} describedBy={describedBy} onClick={() => void setEnabled(row.id, !row.enabled)} />
      </div>
      {summaries !== undefined && <SummariesLine on={summaries} onToggle={() => void setFoldSummaries(!summaries)} />}
    </li>
  );
}

// The summaries' line, starting at the row's middle column (past the image, size-9, and the gap); its sentence its note.
function SummariesLine({ on, onToggle }: { on: boolean; onToggle(): void }) {
  const note = useRowNote();
  return (
    <div {...note.rowProps} className="relative px-2 pb-2">
      <label data-mod-summaries="" className="flex min-w-0 cursor-pointer items-start gap-3 pl-12 text-ui text-fg">
        <span className="min-w-0 flex-1">{L.mod.summaries.label}</span>
        <Switch checked={on} label={L.mod.summaries.label} disabled={false} describedBy={note.id} onClick={onToggle} />
      </label>
      <RowNote note={note} className="pl-14">
        {L.mod.summaries.sentence}
      </RowNote>
    </div>
  );
}
