// One project in Codex's flat tree (§5.1 as amended 2026-10-01, W11, I4 and I8): a 36px disclosure row (Codex's is 30px;
// the owner asked for a little taller) with a folder that opens while expanded and no chevron, the name, the waiting (◐,
// warning) and working (●, accent) counts while collapsed, and its actions on hover in their place (Codex's hover swaps
// the collapsed status for its actions: readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:543909-
// 543917 for the folders, :544150 and :466180 for the swap). A click, Enter or Space expands it in place with the shared
// disclosure motion (`ui/disclosure.tsx`, Codex's group motion at :377892-377927), no slide. Expanded, its sessions in
// one flat list of 30px rows (pinned first, worktree sessions marked by their ⎇ branch), their titles under the
// project's name as Codex's leading slot sets them (:437865-437867), at most five, then "Show more" to eight; a gap
// after the group (Codex's `pb-2`, :377821). A project's hover card is `ProjectHoverCard.tsx` (I6). The pre-W5 group
// (`ProjectGroup.tsx` at 6d50bf26^) is the template. P5 O6 M5 (P5 Decision Log 28): a row is an org project's, its
// sessions from every machine, and it names no machine (T4); its actions act on its checkout (`entry.project`), and New
// chat only on this machine's (another machine's is O7's picker). Each machine's own row (T3: its name, after the
// projects) is the same row without hover actions or a card, with a context menu for its archived sessions. A row whose
// machines are all offline greys (T2). P5 O8 M2: other machines' listed sessions sit among its sessions (`ListedRow.tsx`).
// P5 O8 M5 (Q3): its People toggle (the first hover action, and its menu's checked item; a machine's row has the menu
// alone) draws other people's sessions among them; while it is off, "+N others", faint, counts those it leaves out. The
// toggle is offered only where it can act, with others to show or while it is on (`data-people` tells the menu), so a
// row with neither (every row of a person with no org) is as it was before M5.
// The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J.3): a row whose folders are
// on another machine names its machines after its name (` · `, this Mac's first; a row on this Mac alone, and every row
// signed out, still names none, T4), faint, giving way to the hover actions as the counts do; a row of a project you see only through its
// sessions has no actions and no card, and its menu is `registry:<id>`'s.
// UX wave U7, O-16 (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, Interfaces §D): after
// "Show more", "Hidden · N" with its chevron, while any of its sessions is hidden; open, its hidden sessions follow it as
// ordinary rows one level deeper, each indented one step, so they read as its contents.
import { useState } from 'react';
import type { ProjectId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { MACHINE_OFFLINE, selectShownOffline, usePhaseClock } from '../app/machine-mark';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { usePeople } from '../stores/people'; // P5 O8 M5
import { ChevronDownIcon, FolderIcon, Icon, PlusIcon, SearchIcon } from '../app/IconButton';
import { newChat, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { DisclosureBody } from '../ui/disclosure';
import { isListedRow, type ProjectEntry, type ProjectKey, type SidebarTreeRow } from './derive';
import { ListedRow } from './ListedRow'; // P5 O8 M2
import { focusVisible } from './HoverCard';
import { ProjectHoverCard } from './ProjectHoverCard';
import { machinesWords } from './locations'; // the project registry
import { registrySpawnTarget } from './registry-new-chat'; // the project registry
import type { RegistryProject } from '../stores/registry'; // the project registry
import { useLocationView } from './location-view'; // the project registry
import { runProjectAction, useProjectActionEnabled } from './project-actions';
import { openResumeChooser } from '../resume/host'; // P2-D
import { SessionRow } from './SessionRow';
import { HIDDEN } from './copy'; // UX wave U7, O-16
import { hiddenNodeId, moreNodeId, projectNodeId, useTree } from './tree';

export interface ProjectRowProps {
  entry: ProjectEntry;
  open: boolean;
  sessions: SidebarTreeRow[]; // the rows shown while open (ordered, capped by trees, E3's nested under their parent; P5 O8 M2's listed rows among them); empty while closed
  matchCount?: number;
  more: number; // how many more "Show more" reveals; 0: no Show more row
  hidden?: HiddenRows; // UX wave U7, O-16: its hidden sessions; none while closed or searching
  onToggle(key: ProjectKey): void;
  onShowMore(key: ProjectKey): void;
  onToggleHidden?(key: ProjectKey): void;
}

// UX wave U7, O-16: a project's Hidden row and, while it is open, the rows under it (nested among themselves by lineage).
export interface HiddenRows {
  count: number; // 0: no Hidden row
  open: boolean;
  rows: SidebarTreeRow[]; // empty while closed
}
const NO_HIDDEN: HiddenRows = { count: 0, open: false, rows: [] };

export function ProjectRow({ entry, open, sessions, more, hidden = NO_HIDDEN, matchCount, onToggle, onShowMore, onToggleHidden }: ProjectRowProps) {
  const { key, project, name, rollup } = entry;
  const people = usePeople((s) => (s.on.has(key) || entry.others > 0 ? s.on.has(key) : null)); // null: no toggle offered
  const now = usePhaseClock(); // the UX wave, U9 (O-39): greyed only in the offline and removed phases
  const offline = useMachines((s) => {
    const machines = entry.machine !== null ? [entry.machine] : entry.org.checkouts.map((c) => c.machine);
    return machines.length > 0 && machines.every((m) => selectShownOffline(s, m, now));
  });
  const view = useLocationView();
  const machinesLine = entry.registry !== null ? machinesWords(entry.machines, view) : null; // signed out, a row names no machine, as before
  const tree = useTree();
  const nodeId = projectNodeId(key);
  // The rows stay as they were through the close, so the body folds over what it showed.
  const [kept, setKept] = useState({ sessions, more, hidden });
  if (open && (kept.sessions !== sessions || kept.more !== more || kept.hidden !== hidden)) setKept({ sessions, more, hidden });
  const shown = open ? { sessions, more, hidden } : kept;
  // The hover card (I6) hangs on the line, so a pointer over the expanded sessions does not open it; keyboard focus sits
  // on the treeitem, which opens it (a focus the pointer caused does not, as on every card).
  const [card, setCard] = useState(false);

  const line = (
    <div
      data-project-line
      onClick={() => onToggle(key)}
      className="group/line flex h-9 cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] select-none hover:bg-bg-hover group-focus-visible/project:outline-2 group-focus-visible/project:-outline-offset-2 group-focus-visible/project:outline-accent"
    >
      {open ? <FolderOpenIcon className={`size-[13px] ${project ? 'text-fg-muted' : 'text-fg-faint'}`} /> : <FolderIcon className={`size-[13px] ${project ? 'text-fg-muted' : 'text-fg-faint'}`} />}
      <span className={`min-w-0 flex-1 truncate text-ui ${offline ? 'text-fg-faint' : project ? 'text-fg' : 'text-fg-muted'}`}>{name}</span>
      {machinesLine !== null && (
        <span data-row-machines title={machinesLine} className="max-w-[45%] shrink-0 truncate text-ui-sm text-fg-faint group-hover/line:hidden group-focus-visible/project:hidden">
          {machinesLine}
        </span>
      )}
      {matchCount !== undefined && <span aria-label={`${matchCount} matching sessions`} className="text-ui-sm text-fg-muted tabular-nums">{matchCount}</span>}
      {entry.others > 0 && (
        <span aria-label={othersText(entry.others).slice(1)} className="shrink-0 text-ui-sm text-fg-faint tabular-nums group-hover/line:hidden group-focus-visible/project:hidden">
          {othersText(entry.others)}
        </span>
      )}
      {!open && (rollup.waiting > 0 || rollup.working > 0) && (
        <span className="flex shrink-0 items-center gap-[7px] group-hover/line:hidden group-focus-visible/project:hidden">
          {rollup.waiting > 0 && (
            <span aria-label={`${rollup.waiting} waiting`} className="text-ui-sm text-warning tabular-nums">
              ◐{rollup.waiting}
            </span>
          )}
          {rollup.working > 0 && (
            <span aria-label={`${rollup.working} working`} className="text-ui-sm text-accent tabular-nums">
              ●{rollup.working}
            </span>
          )}
        </span>
      )}
      {project ? (
        <ProjectActions projectId={project.id} rowKey={key} name={name} people={people} registry={entry.registry} />
      ) : entry.registry !== null && people !== null ? (
        // the project registry: a project seen only through sessions (no folder to act through) keeps its People toggle
        <span className={HOVER_ACTIONS}>
          <PeopleAction rowKey={key} name={name} people={people} />
        </span>
      ) : (
        <span aria-hidden className="size-[22px] shrink-0" />
      )}
    </div>
  );

  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded={open}
      aria-selected={false}
      aria-label={offline ? `${name}, ${MACHINE_OFFLINE}` : name}
      tabIndex={tree.tabStop === nodeId ? 0 : -1}
      data-tree-id={nodeId}
      data-kind="project"
      data-offline={offline || undefined}
      data-menu={project ? `project:${project.id}` : entry.machine !== null ? `machine:${entry.machine}` : entry.registry !== null ? `registry:${entry.registry.id}` : undefined}
      data-people={people !== null || undefined}
      onFocus={(event) => {
        if (event.target !== event.currentTarget) return;
        tree.onFocusItem(nodeId);
        if (project && focusVisible(event.currentTarget)) setCard(true);
      }}
      onBlur={(event) => event.target === event.currentTarget && setCard(false)}
      className="group/project outline-none"
    >
      {project ? (
        <ProjectHoverCard entry={{ ...entry, project }} open={card} onOpenChange={setCard}>
          {line}
        </ProjectHoverCard>
      ) : (
        line
      )}
      <DisclosureBody open={open} role="group" aria-label={name} className="pt-px pb-2">
        {shown.sessions.map((row) =>
          isListedRow(row) ? (
            <ListedRow key={row.listed.appId} listed={row.listed} level={2} />
          ) : (
            <SessionRow key={row.record.appId} record={row.record} level={2 + row.depth} nested={row.depth > 0} /* E3: under its lineage parent, at its real depth */ />
          ),
        )}
        {shown.more > 0 && <ShowMoreRow id={moreNodeId(key)} level={2} onShow={() => onShowMore(key)} />}
        {shown.hidden.count > 0 && <HiddenRow id={hiddenNodeId(key)} count={shown.hidden.count} open={shown.hidden.open} onToggle={() => onToggleHidden?.(key)} />}
        {shown.hidden.rows.map((row) =>
          isListedRow(row) ? (
            <ListedRow key={row.listed.appId} listed={row.listed} level={3} indented />
          ) : (
            <SessionRow key={row.record.appId} record={row.record} level={3 + row.depth} nested={row.depth > 0} indented />
          ),
        )}
      </DisclosureBody>
    </div>
  );
}

const ACTION =
  'inline-flex size-[22px] shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-active hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent';

const HOVER_ACTIONS = 'hidden shrink-0 items-center group-hover/line:flex group-focus-visible/project:flex';

// The row's People toggle (P5 O8 M5): pressed while the row draws other people's sessions.
function PeopleAction({ rowKey, name, people }: { rowKey: ProjectKey; name: string; people: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${peopleActionLabel(people)} in ${name}`}
      aria-pressed={people}
      title={peopleActionLabel(people)}
      onClick={(event) => {
        event.stopPropagation();
        usePeople.getState().toggle(rowKey);
      }}
      className={`${ACTION} aria-pressed:bg-bg-active aria-pressed:text-fg`}
    >
      <PeopleIcon className="size-[13px]" />
    </button>
  );
}

// "+N others" (P5 O8 M5): how many of other people's sessions the row's People toggle leaves out.
const othersText = (count: number) => `+${count} ${count === 1 ? 'other' : 'others'}`;
const peopleActionLabel = (on: boolean) => (on ? 'Hide people’s sessions' : 'Show people’s sessions');

// The row's hover actions, out of the tab order (the row is the tree's stop; its context menu carries the same actions
// for the keyboard): where the row offers its People toggle (`people` not null), the people icon toggles the row's other
// people's sessions, pressed while they show (P5 O8 M5, the menu's "Show people's sessions"; first, so the three after
// it keep their places), the search icon opens the Resume… picker on the project (I7, "Resume a session…"), the minus
// removes the project from the sidebar after a confirm (I5; the menu's "Remove from sidebar…"), and "+" opens an
// unstarted session tab in the project ("New chat in X", the New chat landing's open copy item).
function ProjectActions({ projectId, rowKey, name, people, registry }: { projectId: ProjectId; rowKey: ProjectKey; name: string; people: boolean | null; registry: RegistryProject | null }) {
  // the project registry: a project with no folder on this Mac starts on one of its locations elsewhere (registry-new-chat.ts)
  const machines = useMachines((s) => s.machines);
  const here = machineOf(projectId) === ipc.localMachine;
  const elsewhere = here || registry === null ? null : registrySpawnTarget(registry, machines);
  const canCreate = useSessionCreatorRegistered() && (here || elsewhere !== null);
  const canRemove = useProjectActionEnabled('removeProject');
  return (
    <span className={HOVER_ACTIONS}>
      {people !== null && <PeopleAction rowKey={rowKey} name={name} people={people} />}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Resume a session in ${name}`}
        title="Resume a session…"
        onClick={(event) => {
          event.stopPropagation();
          openResumeChooser(projectId, event.currentTarget);
        }}
        className={ACTION}
      >
        <SearchIcon className="size-[13px]" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Remove ${name} from sidebar`}
        title={canRemove ? 'Remove from sidebar' : 'Not available here'}
        disabled={!canRemove}
        onClick={(event) => {
          event.stopPropagation();
          runProjectAction('removeProject', projectId);
        }}
        className={ACTION}
      >
        <Icon className="size-[13px]"><path d="M3 8h10" /></Icon>
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`New chat in ${name}`}
        title={canCreate ? `New chat in ${name}` : 'Not available here'}
        disabled={!canCreate}
        onClick={(event) => {
          event.stopPropagation();
          void newChat({ row: rowKey }); // U13a: here, or elsewhere as `elsewhere` says
        }}
        className={ACTION}
      >
        <PlusIcon className="size-[13px]" />
      </button>
    </span>
  );
}

// "Show more" (Codex's label, `sidebarElectron.showMore`): a tree item of its own, so the keyboard reaches it.
export function ShowMoreRow({ id, level, onShow }: { id: string; level: 1 | 2; onShow(): void }) {
  const tree = useTree();
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={false}
      aria-label="Show more"
      tabIndex={tree.tabStop === id ? 0 : -1}
      data-tree-id={id}
      data-kind="more"
      onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(id)}
      onClick={onShow}
      className="flex h-(--row-h) cursor-default items-center rounded-sm pr-[9px] pl-[30px] text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      Show more
    </div>
  );
}

// UX wave U7, O-16: "Hidden · N", aligned with "Show more", and the chevron the app's other folds use, right while it is
// closed and down while it is open. A tree item that acts as a button (Enter and Space toggle it, `tree.ts`).
export function HiddenRow({ id, count, open, onToggle }: { id: string; count: number; open: boolean; onToggle(): void }) {
  const tree = useTree();
  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-selected={false}
      aria-expanded={open}
      aria-label={HIDDEN.label(count)}
      tabIndex={tree.tabStop === id ? 0 : -1}
      data-tree-id={id}
      data-kind="hidden"
      onFocus={(event) => event.target === event.currentTarget && tree.onFocusItem(id)}
      onClick={onToggle}
      className="flex h-(--row-h) cursor-default items-center gap-[5px] rounded-sm pr-[9px] pl-[30px] text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      {HIDDEN.row(count)}
      <ChevronDownIcon className={`size-[11px] shrink-0 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} />
    </div>
  );
}

// Two people, lucide's `users` redrawn on the 16px grid (P5 O8 M5's People toggle).
const PeopleIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 13.5v-1a3 3 0 0 1 3-3h3a3 3 0 0 1 3 3v1M10.5 3.1a2.5 2.5 0 0 1 0 4.8M14.5 13.5v-1a3 3 0 0 0-2.2-2.9" />
  </Icon>
);

// A folder with its front swung open (Codex's `folder-open` beside `folder` for an expanded project).
const FolderOpenIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2 13V4h5l1.5 2H13v1.5M2 13l1.6-5.5H15L13.4 13z" />
  </Icon>
);
