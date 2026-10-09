// The skills library's list and detail (P2-B execution document §5.10; Claude Desktop's Skills section,
// readable/app-2.16120.0/web/app/v1/c5e558aae-DNGm5L2q.js:1076-1112, :1351-1398, and its plugin badge,
// ccea1f474-BHx9TdZi.js:381-420): My items' group headings, a row per skill (the tile, the skill's name, its plugin's
// name or the engine's source word as a neutral badge, the description on a second line, "Use in chat" at the trailing
// edge), and a small detail in place of the list (Back and ⌘[ return to it with its search and scroll). The badge is plain
// text: in MAWS it would open another widget. "Use in chat" closes the dialog and puts `/<name> ` at the composer's caret,
// sending nothing (§5.10; Desktop's local Code library has no such action, §11).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SortIcon } from '../../app/IconButton';
import { LIBRARY as L, PLUGIN_MANAGEMENT, SKILLS_LIBRARY as S } from '../copy';
import { BackButton, backOnChord } from '../plugins/PluginDetail';
import { Choice, SearchField } from '../plugins/LibraryHeader';
import { useLibraryStore } from '../plugins/library-store';
import { GroupHeading } from '../plugins/PluginRow';
import { badgeOf, labelOf, type SkillGroup, type SkillRow, type SkillsSort } from './skills';

const setSkills = (patch: Partial<ReturnType<typeof useLibraryStore.getState>['skills']>) => useLibraryStore.setState((s) => ({ skills: { ...s.skills, ...patch } }));
const ACTION = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-ui outline-accent focus-visible:outline-2 disabled:cursor-default';
const SECONDARY = `${ACTION} border border-border text-fg hover:bg-bg-hover`;
const PRIMARY = `${ACTION} bg-accent text-bg hover:opacity-90`;
const BADGE = 'shrink-0 truncate rounded-sm bg-bg-active px-1.5 text-ui-sm leading-[18px] text-fg-muted';

// The head's right side: Search skills, Sort by (Plugin name offered only when a plugin brings a skill, Desktop's rule),
// and Reload skills (E8's `reload_skills`, on a ready process).
export function SkillsToolbar({ plugins, canReload, reloading, onReload }: { plugins: boolean; canReload: boolean; reloading: boolean; onReload(): void }) {
  const { search, sort } = useLibraryStore((s) => s.skills);
  const sorts: readonly SkillsSort[] = plugins ? ['name', 'plugin'] : ['name'];
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SearchField label={S.search} value={search} onChange={(next) => setSkills({ search: next })} />
      <Choice label={L.sortBy} icon={<SortIcon />} value={plugins ? sort : 'name'} values={sorts} words={S.sort} isDefault={!plugins || sort === 'name'} onChange={(next) => setSkills({ sort: next })} />
      <button type="button" className={SECONDARY} disabled={!canReload || reloading} onClick={onReload}>
        {PLUGIN_MANAGEMENT.reloadSkills}
      </button>
    </span>
  );
}

// A neutral tile with the slash a skill is typed with (the skills carry no icon).
function SkillTile({ size = 'size-9' }: { size?: string }) {
  return (
    <span aria-hidden className={`flex ${size} shrink-0 items-center justify-center rounded-md border border-border bg-bg-active font-mono text-ui text-fg-muted`}>
      /
    </span>
  );
}

function Centered({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {children}
    </div>
  );
}

// A click inside the row opens its detail unless it landed on a control of its own.
const ownControl = (target: EventTarget): boolean => target instanceof Element && target.closest('button:not([data-row-open])') !== null;

function SkillItem({ row, onOpen, onUse }: { row: SkillRow; onOpen(row: SkillRow): void; onUse(name: string): void }) {
  const label = labelOf(row);
  const badge = badgeOf(row);
  return (
    <li
      data-skill-row={row.name}
      className="relative flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0 hover:bg-bg-hover"
      onClick={(event) => {
        if (!ownControl(event.target)) onOpen(row);
      }}
    >
      <button type="button" data-row-open aria-label={L.view(label)} className="absolute inset-0 rounded-sm outline-accent -outline-offset-2 focus-visible:outline-2" />
      <SkillTile />
      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span data-skill-name className="truncate font-medium text-fg" title={`/${row.name}`}>
            {label}
          </span>
          {badge !== null && (
            <span data-skill-badge className={BADGE}>
              {badge}
            </span>
          )}
        </span>
        {row.description !== '' && <span className="truncate text-ui-sm text-fg-muted">{row.description}</span>}
      </div>
      <button type="button" className={`relative ${SECONDARY}`} onClick={() => onUse(row.name)}>
        {S.useInChat}
      </button>
    </li>
  );
}

function SkillDetail({ row, onBack, onUse }: { row: SkillRow; onBack(): void; onUse(name: string): void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => root.current?.focus(), []);
  const facts: { label: string; value: ReactNode }[] = [
    { label: S.invoke, value: <code className="font-mono text-ui-sm">/{row.name}</code> },
    ...(row.plugin !== null ? [{ label: S.plugin, value: row.plugin }] : []),
    ...(row.source !== '' ? [{ label: S.source, value: row.source }] : []),
  ];
  return (
    <div ref={root} tabIndex={-1} data-skill-detail={row.name} onKeyDown={backOnChord(onBack)} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3 outline-none">
      <BackButton to={S.list} onBack={onBack} />
      <div className="flex items-center gap-3">
        <SkillTile size="size-11" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 truncate text-prose font-semibold text-fg">{labelOf(row)}</h3>
        </div>
        <button type="button" className={PRIMARY} onClick={() => onUse(row.name)}>
          {S.useInChat}
        </button>
      </div>
      {row.description !== '' && <p className="m-0 max-w-[640px] text-ui whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{row.description}</p>}
      <dl className="m-0 grid max-w-[640px] grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-ui-sm">
        {facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-fg-muted">{f.label}</dt>
            <dd className="m-0 min-w-0 text-fg [overflow-wrap:anywhere]">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// The list pane and, in place of it, a row's detail. The list stays mounted beneath the detail so Back returns to it as
// it was; its scroll is restored by hand (an element under `display:none` loses its scrollTop).
export function SkillsLibrary({ groups, shown, onUse, onDetail }: { groups: readonly SkillGroup[]; shown: readonly SkillGroup[]; onUse(name: string): void; onDetail(open: boolean): void }) {
  const [selected, setSelected] = useState<SkillRow | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const left = useRef<{ name: string; scrollTop: number } | null>(null);
  const open = (row: SkillRow) => {
    left.current = { name: row.name, scrollTop: pane.current?.scrollTop ?? 0 };
    setSelected(row);
    onDetail(true);
  };
  const back = () => {
    setSelected(null);
    onDetail(false);
  };
  useLayoutEffect(() => {
    const from = left.current;
    if (selected !== null || from === null || pane.current === null) return;
    left.current = null;
    pane.current.scrollTop = from.scrollTop;
    pane.current.querySelector<HTMLElement>(`[data-skill-row="${CSS.escape(from.name)}"] [data-row-open]`)?.focus();
  }, [selected]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  let body: ReactNode;
  if (total === 0)
    body = (
      <Centered>
        <p className="m-0 text-ui font-medium text-fg">{S.firstTitle}</p>
        <p className="m-0 max-w-sm text-ui-sm text-fg-muted">{S.firstBody}</p>
      </Centered>
    );
  else if (shown.length === 0)
    body = (
      <Centered role="status">
        <p className="m-0 text-ui text-fg-muted">{L.noMatch}</p>
        <button type="button" className={SECONDARY} onClick={() => setSkills({ search: '', sort: 'name' })}>
          {L.resetFilters}
        </button>
      </Centered>
    );
  else
    body = shown.map(({ group, rows }) => (
      <section key={group ?? 'all'} aria-label={group === null ? S.list : L.group[group]} data-skills-group={group ?? 'all'}>
        {group !== null && <GroupHeading label={L.group[group]} count={rows.length} />}
        <ul aria-label={group === null ? S.list : undefined} className="m-0 list-none p-0">
          {rows.map((row) => (
            <SkillItem key={row.name} row={row} onOpen={open} onUse={onUse} />
          ))}
        </ul>
      </section>
    ));

  return (
    <>
      {selected !== null && <SkillDetail row={selected} onBack={back} onUse={onUse} />}
      <div ref={pane} data-skills-list className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 ${selected !== null ? 'hidden' : ''}`}>
        {body}
      </div>
    </>
  );
}
