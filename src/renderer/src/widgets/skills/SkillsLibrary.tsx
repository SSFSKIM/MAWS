// The skills library's list and detail (P2-B execution document §5.10; Claude Desktop's Skills section,
// readable/app-2.16120.0/web/app/v1/c5e558aae-DNGm5L2q.js:1076-1112, :1351-1398, and its plugin badge,
// ccea1f474-BHx9TdZi.js:381-420): My items' group headings, a row per skill (the image, its letter tile, UX wave U11c:
// "Use in chat" says what the old "/" tile said; the skill's name, its plugin's
// name or the engine's source word as a neutral badge, the description on a second line, "Use in chat" at the trailing
// edge), and a small detail in place of the list (Back and ⌘[ return to it with its search and scroll). The badge is plain
// text: in MAWS it would open another widget. "Use in chat" closes the dialog and puts `/<name> ` at the composer's caret,
// sending nothing (§5.10; Desktop's local Code library has no such action, §11). The word cut (G248, P746; the owner's
// ruling of 2026-11-20 for the Skills list and All alike): a row rests as its name and its badge; its description is its
// row note, shown on pointing or focus and the row's description at all times; "Use in chat" is drawn on pointing or
// focus within the row (and always where nothing can point), the detail keeping its button at rest.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SortIcon } from '../../app/IconButton';
import { ItemImage } from '../../customize/image/ItemImage';
import { KindWord, NoLastControl, NoMenu } from '../../customize/KindWord';
import { HOVER_SCOPE, ON_HOVER } from '../../ui/hover-scope';
import { RowNote, useRowNote } from '../../ui/row-note';
import { LIBRARY as L, PLUGIN_MANAGEMENT, SKILLS_LIBRARY as S } from '../copy';
import { BackButton, backOnChord } from '../plugins/PluginDetail';
import { Choice, SearchField } from '../plugins/LibraryHeader';
import { useLibraryStore } from '../plugins/library-store';
import { GroupHeading } from '../plugins/PluginRow';
import { badgeOf, invocationOf, labelOf, type SkillGroup, type SkillRow, type SkillsSort } from './skills';

const setSkills = (patch: Partial<ReturnType<typeof useLibraryStore.getState>['skills']>) => useLibraryStore.setState((s) => ({ skills: { ...s.skills, ...patch } }));
const ACTION = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-ui outline-accent focus-visible:outline-2 disabled:cursor-default disabled:opacity-50';
const SECONDARY = `${ACTION} border border-border text-fg hover:bg-bg-hover`;
const PRIMARY = `${ACTION} bg-accent text-bg hover:opacity-90`;
const BADGE = 'shrink-0 truncate rounded-sm bg-bg-active px-1.5 text-ui-sm leading-[18px] text-fg-muted';

// The head's right side: Search skills, Sort by (Plugin name offered only when a plugin brings a skill, Desktop's rule),
// and Reload skills (E8's `reload_skills`, on a ready process).
// P5 O7 M8: `unavailable`, why Reload is greyed for a session on another machine (lane-b/remote-unavailable.ts)
// UX wave U11a: no `onReload`, no Reload (an unstarted tab's skills are the disk's; there is no engine to reload)
export function SkillsToolbar({ plugins, canReload = false, reloading = false, onReload, unavailable = null }: { plugins: boolean; canReload?: boolean; reloading?: boolean; onReload?(): void; unavailable?: string | null }) {
  const { search, sort } = useLibraryStore((s) => s.skills);
  const sorts: readonly SkillsSort[] = plugins ? ['name', 'plugin'] : ['name'];
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SearchField label={S.search} value={search} onChange={(next) => setSkills({ search: next })} />
      <Choice label={L.sortBy} icon={<SortIcon />} value={plugins ? sort : 'name'} values={sorts} words={S.sort} isDefault={!plugins || sort === 'name'} onChange={(next) => setSkills({ sort: next })} />
      {onReload && (
        <button type="button" className={SECONDARY} disabled={!canReload || reloading || unavailable !== null} title={unavailable ?? undefined} onClick={onReload}>
          {PLUGIN_MANAGEMENT.reloadSkills}
        </button>
      )}
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

// A row's identity across answers: its file, else its name (the list's own key).
export const skillRowKey = (row: SkillRow): string => row.path ?? row.name;

// A click inside the row opens its detail unless it landed on a control of its own.
const ownControl = (target: EventTarget): boolean => target instanceof Element && target.closest('button:not([data-row-open])') !== null;

// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E): under Customize's All, `kindWord`
// ends the row in "Skill" and the width of the last control the other kinds' rows have.
export function SkillItem({ row, onOpen, onUse, kindWord = false }: { row: SkillRow; onOpen(row: SkillRow): void; onUse?(name: string): void; kindWord?: boolean }) {
  const label = labelOf(row);
  const badge = badgeOf(row);
  const invocation = invocationOf(row);
  const rowNote = useRowNote();
  const noted = row.description !== '';
  const describedBy = noted ? rowNote.id : undefined;
  return (
    <li
      data-skill-row={row.name}
      data-skill-key={skillRowKey(row)}
      {...HOVER_SCOPE}
      {...rowNote.rowProps}
      aria-describedby={describedBy}
      className="relative flex items-center gap-3 border-b border-border px-2 py-2 last:border-b-0 hover:bg-bg-hover"
      onClick={(event) => {
        if (!ownControl(event.target)) onOpen(row);
      }}
    >
      <button type="button" data-row-open aria-label={L.view(label)} aria-describedby={describedBy} className="absolute inset-0 rounded-sm outline-accent -outline-offset-2 focus-visible:outline-2" />
      <ItemImage kind="skill" seed={label} iconUrl={null} size="row" />
      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span data-skill-name className="truncate font-medium text-fg" title={invocation === null ? undefined : `/${invocation}`}>
            {label}
          </span>
          {badge !== null && (
            <span data-skill-badge className={BADGE}>
              {badge}
            </span>
          )}
        </span>
      </div>
      {noted && (
        <RowNote note={rowNote} className="pl-14">
          {row.description}
        </RowNote>
      )}
      {onUse && invocation !== null && <button type="button" {...ON_HOVER} className={`relative ${SECONDARY}`} disabled={row.unavailable != null} title={row.unavailable ?? undefined} onClick={() => onUse(invocation)}>
        {S.useInChat}
      </button>}
      {kindWord && (
        <>
          <KindWord kind="skill" />
          <NoLastControl />
          <NoMenu />
        </>
      )}
    </li>
  );
}

// `backTo`: the list Back returns to (Customize's All: My items)
// UX wave U11's skill actions: what a caller adds to the detail (Customize's): `actions` at the head's trailing edge,
// `alert` under the head (why an action did nothing), `note` under the facts (a plugin's skill is replaced by its updates)
export interface SkillDetailExtras {
  actions?: ReactNode;
  alert?: ReactNode;
  note?: ReactNode;
}
export function SkillDetail({ row, onBack, onUse, backTo = S.list, extras = {} }: { row: SkillRow; onBack(): void; onUse?(name: string): void; backTo?: string; extras?: SkillDetailExtras }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => root.current?.focus(), []);
  const invocation = invocationOf(row);
  const facts: { label: string; value: ReactNode }[] = [
    ...(invocation !== null ? [{ label: S.invoke, value: <code className="font-mono text-ui-sm">/{invocation}</code> }] : []),
    ...(row.plugin !== null ? [{ label: S.plugin, value: row.plugin }] : []),
    ...(row.source !== '' ? [{ label: S.source, value: row.source }] : []),
    ...(row.path ? [{ label: 'File', value: row.path }] : []),
  ];
  return (
    <div ref={root} tabIndex={-1} data-skill-detail={row.name} onKeyDown={backOnChord(onBack)} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3 outline-none">
      <BackButton to={backTo} onBack={onBack} />
      <div className="flex items-center gap-3">
        <ItemImage kind="skill" seed={labelOf(row)} iconUrl={null} size="head" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 tabIndex={-1} data-skill-heading className="m-0 truncate rounded-sm text-prose font-semibold text-fg outline-accent focus-visible:outline-2">
            {labelOf(row)}
          </h3>
        </div>
        {onUse && invocation !== null && <button type="button" className={PRIMARY} disabled={row.unavailable != null} title={row.unavailable ?? undefined} onClick={() => onUse(invocation)}>
          {S.useInChat}
        </button>}
        {extras.actions}
      </div>
      {extras.alert}
      {row.description !== '' && <p className="m-0 max-w-[640px] text-ui whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{row.description}</p>}
      <dl className="m-0 grid max-w-[640px] grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-ui-sm">
        {facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-fg-muted">{f.label}</dt>
            <dd className="m-0 min-w-0 text-fg [overflow-wrap:anywhere]">{f.value}</dd>
          </div>
        ))}
      </dl>
      {extras.note != null && <p data-skill-note className="m-0 max-w-[640px] text-ui-sm text-fg-muted">{extras.note}</p>}
    </div>
  );
}

// The list pane and, in place of it, a row's detail. The list stays mounted beneath the detail so Back returns to it as
// it was; its scroll is restored by hand (an element under `display:none` loses its scrollTop). The detail is the
// selected row as `groups` has it now, so what it offers follows a new answer or a changed launch profile (the task
// review of the branch panel's fix); a row a new answer no longer lists leaves the detail for the list.
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D): on Customize's page, `onReset` clears
// the page's search in place of the library store's, and each new `toList` (the page's view or a Show value pressed)
// returns the detail to the list.
export function SkillsLibrary({ groups, shown, onUse, onDetail, onReset, toList, extrasOf }: { groups: readonly SkillGroup[]; shown: readonly SkillGroup[]; onUse?(name: string): void; onDetail(open: boolean): void; onReset?(): void; toList?: number; extrasOf?(row: SkillRow): SkillDetailExtras }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listed, setListed] = useState(toList);
  if (listed !== toList) {
    setListed(toList);
    setSelectedKey(null);
  }
  const selected = useMemo(() => (selectedKey === null ? null : (groups.flatMap((g) => g.rows).find((row) => skillRowKey(row) === selectedKey) ?? null)), [groups, selectedKey]);
  const pane = useRef<HTMLDivElement>(null);
  const left = useRef<{ key: string; scrollTop: number } | null>(null);
  if (selectedKey !== null && selected === null) setSelectedKey(null); // its skill is gone: the list again
  const open = (row: SkillRow) => {
    left.current = { key: skillRowKey(row), scrollTop: pane.current?.scrollTop ?? 0 };
    setSelectedKey(skillRowKey(row));
  };
  const back = () => setSelectedKey(null);
  const inDetail = selected !== null;
  useLayoutEffect(() => onDetail(inDetail), [inDetail, onDetail]);
  useLayoutEffect(() => {
    const from = left.current;
    if (selectedKey !== null || from === null || pane.current === null) return;
    left.current = null;
    pane.current.scrollTop = from.scrollTop;
    // its row (a name two scopes can share); a row a new answer no longer lists, the list's first row, else the list, but
    // only when the keyboard went with the closing detail (not where the person has since taken it)
    const row = pane.current.querySelector<HTMLElement>(`[data-skill-key="${CSS.escape(from.key)}"] [data-row-open]`);
    if (row !== null) row.focus();
    else if (document.activeElement === null || document.activeElement === document.body) (pane.current.querySelector<HTMLElement>('[data-row-open]') ?? pane.current).focus();
  }, [selectedKey]);

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
        <button type="button" className={SECONDARY} onClick={onReset ?? (() => setSkills({ search: '', sort: 'name' }))}>
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
            <SkillItem key={row.path ?? row.name} row={row} onOpen={open} onUse={onUse} />
          ))}
        </ul>
      </section>
    ));

  return (
    <>
      {selected !== null && <SkillDetail row={selected} onBack={back} onUse={onUse} extras={extrasOf?.(selected)} />}
      <div ref={pane} tabIndex={-1} data-skills-list className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 outline-none ${selected !== null ? 'hidden' : ''}`}>
        {body}
      </div>
    </>
  );
}
