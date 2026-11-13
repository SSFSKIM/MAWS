// The sidebar (§5.1 as amended 2026-10-01, W11; C5 execution document, M3): Codex's flat tree under the New chat row and
// one search field. The project rows (P5 O6 M5: org projects, each holding every machine's sessions of it), most recently
// active first, five of them and then "Show more" for the rest, with each machine's own row last (its sessions with no
// checkout, in place of "Other sessions"); each expands in place to its sessions (`ProjectRow.tsx`), and which are expanded persists in the
// `regions` layout key (`expandedProjects`), so a relaunch shows what the person left; the search and the "Show more"
// reveals do not persist. The search filters every project (by name, or holding a matching session) and shows each
// listed project open on its matching sessions without changing what is expanded. M2 restores Needs you above the
// tree, independent of search and hidden projects, from the same attention table as the Overview. One context menu
// serves every row, and the tree is one roving tab stop (`tree.ts`). A project removed from the sidebar (I5) is listed
// nowhere, its sessions with it, and "Hidden projects…" at the end offers it back. P5 O8 M2: other machines' listed
// sessions the member owns join their rows' sessions (`projectItems`), under the same caps and search. P5 O8 M5: other
// people's join them too under a row whose People toggle is on (`stores/people.ts`), each row naming its owners. The
// project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §J): one row per project id, every
// project of the org the person can reach, the registry's own after this app's machines' (`projectList`); a removal held
// for a machine that is off is listed in Hidden projects…, which shows while one waits. UX wave U7, O-16
// (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M3): a hidden session (`stores/hidden.ts`)
// leaves its project's list after ranking and before the caps (`splitHidden`) for the project's Hidden row, which is open
// for the run only; an unhidden one leads its list as a session spawned here does; a Hide or an Unhide settles the held
// order at once and places the keyboard (M3, decision 6). A search draws every match in place and no Hidden row.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FolderIcon, GearIcon, IconButton, SortIcon } from '../app/IconButton';
import { openCustomize, openProjects } from '../customize/open';
import { useChordHint } from '../app/IconButton'; // C11
import { NEW_CHAT, newChat, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { runAction, useActionEnabled } from '../keymap/actions-runtime'; // C11: the footer's gear opens Settings
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName, selectOrgIndex } from '../stores/org-projects'; // P5 O6 M5
import { ProjectFilter } from './ProjectFilter';
import { issuedAt, lastActivity, seenActivity, type SidebarSort } from '../overview/derive';
import { useNowEvery } from '../app/use-now';
import { selectGreyedNeedsYou, selectNeedsYou, useAttention } from '../stores/attention';
import { useSpawnedHere } from '../sessions/spawned-here'; // P5 O7 M8
import { pageOpen, tabOnScreen, useLayout, type LayoutState } from '../stores/layout';
import { openArtifacts } from '../main/artifacts'; // P3-G
import { selectHiddenProjects, selectProjectOrder, useSessions } from '../stores/sessions';
import { usePeople } from '../stores/people'; // P5 O8 M5
import { useHidden } from '../stores/hidden'; // UX wave U7, O-16
import { openDialog } from '../sessions/dialogs';
import { filterProjectList, isListedRow, listedMatcher, nestItems, projectItems, projectList, projectSessions, PROJECTS_FIRST, sessionMatcher, shownTrees, sidebarSessionId, splitHidden, type ProjectEntry, type ProjectKey, type SidebarSession, type SidebarTreeRow } from './derive';
import type { AppSessionId } from '@shared/graph/ids';
import type { Destination } from '@shared/ipc/schema/layout';
import { menuTargetOf, SidebarMenuContent, type MenuTarget } from './menus';
import { ProjectRow, ShowMoreRow, type HiddenRows } from './ProjectRow';
import { ResumeChooserHost } from '../resume/host'; // P2-D
import { registerProjectRevealer } from './reveal';
import { AddProject } from './AddProject';
import { Search } from './Search';
import { SidebarInteractionContext } from './interaction';
import { openConversationSearch, openPalette } from '../palette/CommandPalette';
import { NeedsYou, RECONNECTING } from './NeedsYou';
import { SectionHeading } from './SectionHeading';
import { HubNotice } from './HubNotice'; // P5 O7 M2
import { hiddenNodeId, moreNodeId, projectNodeId, sessionNodeId, treeCommand, TreeContext, type TreeNode } from './tree';

export function Sidebar() {
  const sessionsLoaded = useSessions((s) => s.loaded);
  const attentionLoaded = useAttention((s) => s.loaded);
  const loaded = sessionsLoaded && attentionLoaded;
  return (
    <div className="flex min-h-0 flex-1 flex-col text-fg" aria-busy={!loaded}>
      {loaded ? <SidebarBody /> : <SidebarSkeleton />}
      <Footer />
    </div>
  );
}

// A project's entry with its sessions in the sidebar's order (P5 O8 M2: records and listed rows together).
type RankedEntry = ProjectEntry & { items: SidebarSession[] };

// A listed project as the tree shows it: open or not, the sessions it shows and how many more its "Show more" reveals.
interface ShownProject {
  entry: RankedEntry;
  open: boolean;
  sessions: SidebarTreeRow[]; // E3: each nested under its lineage parent when that is listed
  more: number;
  items: SidebarSession[]; // UX wave U7, O-16: the sessions it may draw, its hidden ones aside
  hidden: HiddenRows; // UX wave U7, O-16
}
const NO_HIDDEN: HiddenRows = { count: 0, open: false, rows: [] };
const rowId = (row: SidebarTreeRow): AppSessionId => (isListedRow(row) ? row.listed.appId : row.record.appId);

const MORE_PROJECTS = moreNodeId(null);
/** How coarse the sidebar's ranking clock is (P5 O7 M10's follow-up): a row whose unread passes 24 h moves within it. */
const RANK_CLOCK_MS = 5 * 60_000;

function SidebarBody() {
  const searchChord = useChordHint('palette.open');
  const records = useSessions((s) => s.records);
  const recordsVersion = useSessions((s) => s.recordsVersion);
  const digests = useSessions((s) => s.digests);
  const listedSessions = useSessions((s) => s.listed); // P5 O8 M2
  const turnsSeen = useSessions((s) => s.turnsSeen); // P5 O7 M10
  const reconnecting = useSessions((s) => s.reconnecting); // UX wave U7, ticket 407: a read of this Mac's sessions is refused
  const seen = useMemo(() => seenActivity(listedSessions, turnsSeen), [listedSessions, turnsSeen]); // P5 O7 M10: a remote record's activity
  // P5 O7 M10's follow-up: the clock an unread session's 24 h freshness is judged at, rounded to RANK_CLOCK_MS, so a row
  // past its window moves within that much of crossing it (or at the next store change), with no timer per row
  const now = useNowEvery(RANK_CLOCK_MS);
  const people = usePeople((s) => s.on); // P5 O8 M5: the rows drawing other people's sessions
  const spawnedHere = useSpawnedHere((s) => s.leading); // P5 O7 M8: the sessions spawned here that lead their group
  // UX wave U7, O-16: the hidden sessions; an unhidden one leads its group as a spawned one does (Interfaces §D), and each
  // Hide or Unhide settles the held order at once
  const hiddenSessions = useHidden((s) => s.hidden);
  const unhidden = useHidden((s) => s.leading);
  const hideActs = useHidden((s) => s.acts);
  const spawned = useMemo(() => (unhidden.size === 0 ? spawnedHere : new Set([...spawnedHere, ...unhidden])), [spawnedHere, unhidden]);
  const [projectFilter, setProjectFilter] = useState<ReadonlySet<ProjectKey> | null>(null);
  const allKnownProjects = useSessions(selectProjectOrder);
  const hiddenProjects = useSessions(selectHiddenProjects);
  const rows = useAttention((s) => selectNeedsYou(s, { records, recordsVersion, listed: listedSessions }));
  const greyedRows = useAttention((s) => selectGreyedNeedsYou(s, { records, recordsVersion, listed: listedSessions })); // P5 O7 M6
  // P5 O6 M5: every machine's projects, grouped by org project; a machine's sessions with no checkout under its own row
  const projects = useSessions((s) => s.projects);
  const registry = useSessions((s) => s.registry); // the project registry
  const machines = useMachines((s) => s.machines);
  const local = ipc.localMachine;
  const index = useSessions((s) => selectOrgIndex(s, local));
  const sidebar = useLayout((s) => s.regions.sidebar);
  // UX wave U7b: under a page no session row is selected (the tab behind it is not on screen).
  const selectedTab = useLayout((s) => {
    const tab = tabOnScreen(s);
    return tab?.kind === 'session' ? tab.appSessionId : null;
  });
  // P5 O8 M2: a listed row clicked with no opener for its lane is the selection until the shown tab changes or another
  // row is clicked.
  // Cleared, not just hidden, at the first render with another tab, so the tab it was picked over coming back does not
  // bring it back (React's state adjusted while rendering: this render is discarded for the one without it).
  const [picked, setPicked] = useState<{ id: AppSessionId; over: AppSessionId | null } | null>(null);
  if (picked !== null && picked.over !== selectedTab) setPicked(null);
  const page = useLayout(pageOpen); // UX wave U7b: nor a listed row picked over no tab, while a page is open
  const selected = page ? null : picked !== null && picked.over === selectedTab ? picked.id : selectedTab;

  const [query, setQuery] = useState('');
  const [allProjects, setAllProjects] = useState(false); // the list's own "Show more" (transient)
  const [more, setMore] = useState<ReadonlySet<ProjectKey>>(new Set()); // projects whose "Show more" was clicked (transient)
  const [openHidden, setOpenHidden] = useState<ReadonlySet<ProjectKey>>(new Set()); // UX wave U7, O-16: projects whose Hidden row is open (transient)
  const [focused, setFocused] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null); // a tree item to focus once a render shows it
  const placeAfterHide = useRef<{ key: ProjectKey; at: number } | null>(null); // UX wave U7, O-16: where a hidden row stood
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [pointerWithin, setPointerWithin] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const pointerOwner = useRef<Node | null>(null);
  const focusOwner = useRef<Node | null>(null);
  const ownPointer = (target: EventTarget, fallback: HTMLElement) => {
    // Row and portal shells survive incidental icon/text replacement; their actual removal still ends ownership.
    pointerOwner.current = (target as Element).closest('[role="treeitem"], [data-needs-you], [role="dialog"], [role="menu"]') ?? fallback;
    setPointerWithin(true);
  };
  const releaseRemoved = useCallback((removed: Node) => {
    if (pointerOwner.current && removed.contains(pointerOwner.current)) {
      pointerOwner.current = null;
      setPointerWithin(false);
    }
    if (focusOwner.current && removed.contains(focusOwner.current)) {
      focusOwner.current = null;
      setFocusWithin(false);
    }
  }, []);
  useEffect(() => {
    // Clear at document capture first; this subtree's React capture renews ownership for its own controls,
    // including portals. A focus elsewhere also clears stale ownership left by a removed portal.
    const clearFocus = () => { focusOwner.current = null; setFocusWithin(false); };
    document.addEventListener('focusin', clearFocus, true);
    return () => document.removeEventListener('focusin', clearFocus, true);
  }, []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLDivElement>(null);

  const rankedEntries = useMemo((): RankedEntry[] => projectList({ records, digests, projects, rows, local, machineName: (m) => machineName(machines, m, local), alsoListed: projectFilter ?? undefined, listed: listedSessions, people, seen, registry }).map((entry) => {
    const sorted = projectSessions({ sessions: entry.sessions, digests, rows, sort: sidebar.sort, matches: () => true, spawned, seen, listings: listedSessions, now });
    return { ...entry, sessions: sorted, items: projectItems({ sorted, listed: entry.listed, digests, rows, sort: sidebar.sort, spawned, seen, listings: listedSessions, now }) };
  }), [records, digests, projects, rows, local, machines, projectFilter, sidebar.sort, listedSessions, people, spawned, seen, now, registry]);
  // Hold ranks, not data: titles, glyphs and counts remain live. Pointer presence, keyboard focus (including
  // portalled cards/menus), or an open context menu keeps the same targets in place until the person leaves.
  // A deliberate sort change is immediate, and so is a Hide or an Unhide (UX wave U7, O-16); no timer can reshuffle a
  // row between two actions.
  const holding = pointerWithin || focusWithin || menuTarget !== null;
  // UX wave U7, O-16: a hidden row of the Hidden list is ordered by its newest activity, as the sidebar's age reads it; that
  // order is held with the ranks
  const activityOf = useCallback(
    (item: SidebarSession) => (item.kind === 'record' ? lastActivity(item.record, digests.get(item.record.appId), seen.get(item.record.appId)) : issuedAt(item.listed)),
    [digests, seen],
  );
  const hiddenOrder = useMemo(
    () => new Map(rankedEntries.map((entry) => [entry.key, splitHidden(entry.items, (id) => hiddenSessions.has(id), activityOf).hidden])),
    [rankedEntries, hiddenSessions, activityOf],
  );
  // An act settles even when it changed no rank (a Hide with no lead): it is consumed then, never left to release a later
  // live update while the person is still inside.
  const [settledOrder, setSettledOrder] = useState({ entries: rankedEntries, hidden: hiddenOrder, sort: sidebar.sort, acts: hideActs });
  if (settledOrder.acts !== hideActs || ((!holding || settledOrder.sort !== sidebar.sort) && (settledOrder.entries !== rankedEntries || settledOrder.hidden !== hiddenOrder))) {
    setSettledOrder({ entries: rankedEntries, hidden: hiddenOrder, sort: sidebar.sort, acts: hideActs });
  }
  const everyEntry = useMemo(() => {
    if (!holding) return rankedEntries;
    const previous = new Map(settledOrder.entries.map((entry) => [entry.key, entry]));
    return holdOrder(rankedEntries, settledOrder.entries, (entry) => entry.key).map((entry) => ({
      ...entry,
      items: holdOrder(entry.items, previous.get(entry.key)?.items ?? [], sidebarSessionId),
    }));
  }, [rankedEntries, settledOrder, holding]);
  const searching = query.trim() !== '';
  const matches = useMemo(() => sessionMatcher(query, projects), [query, projects]);
  const itemMatches = useMemo(() => {
    const matchesListed = listedMatcher(query);
    return (item: SidebarSession) => (item.kind === 'record' ? matches(item.record) : matchesListed(item.listed));
  }, [query, matches]);
  const expanded = useMemo(() => new Set(sidebar.expandedProjects), [sidebar.expandedProjects]);
  // UX wave U7, O-16: a row that returns from the Hidden list while the keyboard is on it, or on the Hidden row the return
  // empties, keeps the keyboard and stays drawn while the keyboard stays on it: exempt from the caps as a spawned lead is, at
  // its own rank and with no lead. Once the keyboard leaves it, it falls under the caps like any row.
  const [kept, setKept] = useState<{ hidden: typeof hiddenSessions; id: AppSessionId | null }>({ hidden: hiddenSessions, id: null });
  if (kept.hidden !== hiddenSessions) {
    const empties = (id: AppSessionId) => {
      const entry = rankedEntries.find((e) => e.items.some((item) => sidebarSessionId(item) === id));
      return entry !== undefined && focused === hiddenNodeId(entry.key) && !entry.items.some((item) => hiddenSessions.has(sidebarSessionId(item)));
    };
    const back = focusWithin ? [...kept.hidden.keys()].find((id) => !hiddenSessions.has(id) && (focused === sessionNodeId(id) || empties(id))) : undefined;
    setKept({ hidden: hiddenSessions, id: back ?? kept.id });
    if (back !== undefined) setFocused(sessionNodeId(back));
  } else if (kept.id !== null && !(focusWithin && focused === sessionNodeId(kept.id))) {
    setKept({ hidden: hiddenSessions, id: null });
  }
  const uncapped = useMemo(() => (kept.id === null ? spawned : new Set([...spawned, kept.id])), [spawned, kept.id]);

  // Five project rows, then "Show more" for the rest (Codex's `maxGroups`); the machines' rows stay last whatever is
  // folded. A search lists every project it finds.
  const { listed, folded } = useMemo(() => {
    const found = filterProjectList(everyEntry, query, projects).filter((entry) => projectFilter === null || (entry.machine === null && projectFilter.has(entry.key)));
    if (searching || allProjects || projectFilter !== null) return { listed: found, folded: 0 };
    const real = found.filter((e) => e.machine === null);
    const own = found.filter((e) => e.machine !== null);
    return { listed: [...real.slice(0, PROJECTS_FIRST), ...own], folded: Math.max(0, real.length - PROJECTS_FIRST) };
  }, [everyEntry, query, projects, searching, allProjects, projectFilter]);

  const shown: ShownProject[] = useMemo(
    () =>
      listed.map((entry) => {
        const open = searching || expanded.has(entry.key);
        if (!open) return { entry, open, sessions: [], more: 0, items: [], hidden: NO_HIDDEN };
        const matching = entry.items.filter(itemMatches);
        if (searching) return { entry, open, sessions: nestItems(matching).flatMap((tree) => tree.rows), more: 0, items: matching, hidden: NO_HIDDEN }; // a search draws every match in place
        const split = splitHidden(matching, (id) => hiddenSessions.has(id), activityOf); // after ranking, before the caps
        const all = nestItems(split.shown); // E3: the caps count trees; rank was settled above
        const drawn = shownTrees(all, more.has(entry.key), uncapped); // P5 O7 M8: a spawned lead is never cut (nor a row that kept the keyboard)
        const hiddenOpen = openHidden.has(entry.key) && split.hidden.length > 0;
        const hiddenItems = holding ? holdOrder(split.hidden, settledOrder.hidden.get(entry.key) ?? [], sidebarSessionId) : split.hidden;
        const hidden = split.hidden.length === 0 ? NO_HIDDEN : { count: split.hidden.length, open: hiddenOpen, rows: hiddenOpen ? nestItems(hiddenItems).flatMap((tree) => tree.rows) : [] };
        return { entry, open, sessions: drawn.shown.flatMap((tree) => tree.rows), more: drawn.more, items: split.shown, hidden };
      }),
    [listed, searching, expanded, itemMatches, more, uncapped, hiddenSessions, activityOf, openHidden, holding, settledOrder],
  );
  // A Hidden row whose last session returned or was unhidden closes, so the next Hide finds it closed.
  const emptied = searching ? [] : [...openHidden].filter((key) => shown.some((p) => p.entry.key === key && p.open && p.hidden.count === 0));
  if (emptied.length > 0) setOpenHidden(new Set([...openHidden].filter((key) => !emptied.includes(key))));
  // The list's "Show more" sits after the last project row, before the machines' rows.
  const moreAt = folded > 0 ? shown.filter((p) => p.entry.machine === null).length : -1;

  // The tree items on screen, in order: what the arrow keys walk.
  const nodes = useMemo(() => {
    const out: TreeNode[] = [];
    // E3: a nested row's parent is its lineage parent's row, so ArrowLeft lands there; under the Hidden row every row's is
    // the Hidden row (UX wave U7, O-16), a lineage child's included
    const rowNodes = (rows: SidebarTreeRow[], parent: string, byLineage: boolean) => rows.map((row): TreeNode => isListedRow(row)
      ? { id: sessionNodeId(row.listed.appId), kind: 'listed', appSessionId: row.listed.appId, parent }
      : { id: sessionNodeId(row.record.appId), kind: 'session', appSessionId: row.record.appId, parent: !byLineage || row.nestedUnder === null ? parent : sessionNodeId(row.nestedUnder) });
    shown.forEach(({ entry, open, sessions, more: folded, hidden }, i) => {
      if (i === moreAt) out.push({ id: MORE_PROJECTS, kind: 'more', key: null, parent: null });
      const id = projectNodeId(entry.key);
      out.push({ id, kind: 'project', key: entry.key, expanded: open });
      if (!open) return;
      out.push(...rowNodes(sessions, id, true));
      if (folded > 0) out.push({ id: moreNodeId(entry.key), kind: 'more', key: entry.key, parent: id });
      if (hidden.count === 0) return;
      const hiddenId = hiddenNodeId(entry.key); // UX wave U7, O-16: its rows step out to it
      out.push({ id: hiddenId, kind: 'hidden', key: entry.key, expanded: hidden.open, parent: id });
      out.push(...rowNodes(hidden.rows, hiddenId, false));
    });
    if (moreAt === shown.length) out.push({ id: MORE_PROJECTS, kind: 'more', key: null, parent: null });
    return out;
  }, [shown, moreAt]);
  const selectedNode = selected === null ? null : sessionNodeId(selected);
  const tabStop = nodes.some((n) => n.id === focused) ? focused : nodes.some((n) => n.id === selectedNode) ? selectedNode : (nodes[0]?.id ?? null);

  // Stable (they read refs alone), so an effect can name `focusItem` among its dependencies.
  const itemElement = useCallback((id: string) => scroller.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`) ?? null, []);
  const focusItem = useCallback(
    (id: string) => {
      const element = itemElement(id);
      if (element) element.focus();
      else pendingFocus.current = id;
    },
    [itemElement],
  );
  // UX wave U7, O-16: a row that returns from the Hidden list is drawn anew in its project's list, so the keyboard it held
  // goes back to it. When the Hidden row goes (its last session returned or gone) while the keyboard is on it or on a row
  // under it, the keyboard goes to the row that returned, else to the project's row; a row under it that left alone
  // hands it to the Hidden row. Only a keyboard the sidebar held is placed: its focus owner, which this commit removed.
  // Before the reconcile below, which releases that owner.
  const drawnBefore = useRef({ nodes, hidden: hiddenSessions });
  useLayoutEffect(() => {
    const before = drawnBefore.current;
    drawnBefore.current = { nodes, hidden: hiddenSessions };
    const owner = focusOwner.current;
    if (!(owner instanceof Element) || owner.isConnected) return;
    const id = owner.closest('[data-tree-id]')?.getAttribute('data-tree-id');
    const node = before.nodes.find((n) => n.id === id);
    if (node === undefined || node.kind === 'project') return;
    const parent = node.parent;
    const disclosure = node.kind === 'hidden' ? node : before.nodes.find((n) => n.kind === 'hidden' && n.id === parent);
    if (disclosure?.kind !== 'hidden') return;
    const has = (target: string) => nodes.some((n) => n.id === target);
    const project = disclosure.parent;
    const inProject = (n: TreeNode): boolean => n.kind !== 'project' && (n.parent === project || nodes.some((m) => m.id === n.parent && inProject(m)));
    const returned = nodes.find((n) => (n.kind === 'session' || n.kind === 'listed') && before.hidden.has(n.appSessionId) && !hiddenSessions.has(n.appSessionId) && inProject(n));
    const target = node.kind !== 'hidden' && has(node.id) ? node.id : has(disclosure.id) ? disclosure.id : (returned?.id ?? project);
    if (has(target)) focusItem(target);
  }, [nodes, hiddenSessions, focusItem]);
  useLayoutEffect(() => {
    // Removing a row can omit leave/blur and move focus to BODY without focusin. Reconcile after this
    // sidebar's commit; surviving targets and focus transfers performed by children keep their ownership.
    for (const owner of [pointerOwner.current, focusOwner.current]) {
      if (owner && !owner.isConnected) releaseRemoved(owner);
    }
  });
  // UX wave U7, O-16 (M3, decision 6): after a Hide the keyboard goes to the row that took the hidden row's place, else to
  // the Hidden row, once the render without it is on screen. A Hide that places the keyboard (`hideAct`) always changes
  // `shown` (its row leaves its group), so the effect runs after that render.
  useEffect(() => {
    const place = placeAfterHide.current;
    if (place === null) return;
    placeAfterHide.current = null;
    const group = shown.find((p) => p.entry.key === place.key);
    if (!group?.open) return;
    const next = group.sessions[place.at];
    const id = next !== undefined ? sessionNodeId(rowId(next)) : hiddenNodeId(place.key);
    setFocused(id);
    focusItem(id);
  }, [shown, focusItem]);
  // An item not on screen yet (the first row a "Show more" revealed, a revealed project) takes focus, and with it the
  // scroll, after the render that shows it.
  useEffect(() => {
    const id = pendingFocus.current;
    const element = id === null ? null : itemElement(id);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  // A project revealed from outside (`reveal.ts`, the ⌘K palette) is expanded there; here the search clears and the
  // folded projects show, so its row is on screen, and the row takes focus after the render that shows it (and that
  // lifts a collapsed sidebar's `inert`).
  useEffect(
    () =>
      registerProjectRevealer((key) => {
        setQuery('');
        setProjectFilter(null);
        setAllProjects(true);
        setFocused(null);
        pendingFocus.current = projectNodeId(key);
        rerender(); // the row may be on screen already: the focus effect still runs
      }),
    [],
  );

  // A project's activation, one path for a click on its row and its keys (Enter, Space, ArrowRight, ArrowLeft): the row
  // opens or closes, and nothing else (UX wave U13a: the strip is one and no row changes it).
  const toggleProject = (key: ProjectKey) => {
    if (searching) return; // a search shows its matches open without changing what is expanded
    const open = sidebar.expandedProjects.includes(key);
    if (open && more.has(key)) {
      const next = new Set(more);
      next.delete(key);
      setMore(next); // a project opened again shows its first five
    }
    if (open && openHidden.has(key)) {
      const next = new Set(openHidden);
      next.delete(key);
      setOpenHidden(next); // UX wave U7, O-16: and its Hidden row closed
    }
    // Closes or opens the row as seen, over whatever list it lands on (a click before the layout hydrates is replayed
    // over the saved expansions).
    useLayout.getState().setSidebar(({ expandedProjects: list }) => ({
      expandedProjects: open ? list.filter((k) => k !== key) : list.includes(key) ? list : [...list, key],
    }));
  };
  const showMore = (key: ProjectKey | null) => {
    if (key === null) {
      const next = everyEntry.filter((e) => e.machine === null)[PROJECTS_FIRST];
      setAllProjects(true);
      if (next) focusItem(projectNodeId(next.key));
      return;
    }
    const group = shown.find((p) => p.entry.key === key);
    if (!group) return;
    setMore(new Set(more).add(key));
    const drawn = new Set(group.sessions.filter((row) => row.nestedUnder === null).map(rowId)); // E3: the trees' roots
    const next = nestItems(group.items).find((tree) => !drawn.has(sidebarSessionId(tree.root)))?.root; // P5 O7 M8: a lead past the cap is drawn already
    if (next) focusItem(sessionNodeId(sidebarSessionId(next)));
  };

  const onTreeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = (event.target as HTMLElement).getAttribute('data-tree-id');
    if (id === null) return; // a key on a control inside a row is the control's
    const command = treeCommand(nodes, id, event.key);
    if (!command) return;
    event.preventDefault();
    switch (command.kind) {
      case 'focus':
        focusItem(command.id);
        break;
      case 'open':
        useLayout.getState().openSession(command.appSessionId);
        break;
      case 'toggle':
        toggleProject(command.key);
        break;
      case 'more':
        showMore(command.key);
        break;
      case 'hidden':
        toggleHidden(command.key);
        break;
    }
  };

  // UX wave U7, O-16: a project's Hidden row opens and closes in place, for the run.
  const toggleHidden = (key: ProjectKey) => {
    const next = new Set(openHidden);
    if (!next.delete(key)) next.add(key);
    setOpenHidden(next);
  };
  // A Hide or an Unhide from a tree row (its menu or its button; a Needs you row offers neither), and where the keyboard
  // goes after it (M3, decision 6): after Unhide to the unhidden row, at its list's head, once the render that moves it is
  // on screen; after Hide to the row that takes its place (the effect above), else the Hidden row.
  const hideAct = (id: AppSessionId, hide: boolean): boolean => {
    const store = useHidden.getState();
    if (!hide) {
      const moves = shown.some((p) => p.open && p.hidden.rows.some((row) => rowId(row) === id));
      store.unhide(id);
      if (moves) {
        setFocused(sessionNodeId(id));
        pendingFocus.current = sessionNodeId(id);
      }
      return moves;
    }
    const group = shown.find((p) => p.open && p.sessions.some((row) => rowId(row) === id));
    store.hide(id);
    if (group !== undefined) placeAfterHide.current = { key: group.entry.key, at: group.sessions.findIndex((row) => rowId(row) === id) };
    return group !== undefined;
  };

  const tree = { tabStop, selected, onFocusItem: setFocused, onPick: (id: AppSessionId) => setPicked({ id, over: selectedTab }), onHideAct: hideAct };
  const selectedKey = everyEntry.find((entry) => entry.machine === null && selected !== null && entry.sessions.some((r) => r.appId === selected))?.key ?? null; // the filter's own: an org row's
  const listEmpty = everyEntry.length === 0;
  const moreProjects = <ShowMoreRow id={MORE_PROJECTS} level={1} onShow={() => showMore(null)} />;

  return (
    <TreeContext.Provider value={tree}>
      <SidebarInteractionContext.Provider value={releaseRemoved}>
      <div className="flex min-h-0 flex-1 flex-col"
        onPointerEnter={(event) => ownPointer(event.target, event.currentTarget)}
        onPointerOverCapture={(event) => ownPointer(event.target, event.currentTarget)}
        onPointerLeave={() => { pointerOwner.current = null; setPointerWithin(false); }}
        onFocusCapture={(event) => { focusOwner.current = event.target; setFocusWithin(true); }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) { focusOwner.current = null; setFocusWithin(false); }
        }}>
        <SidebarDestinations>
          <div ref={search}>
            <Search value={query} onChange={setQuery} label="Search projects and sessions" onSearch={openPalette} chord={searchChord} onLeave={() => {
              const waiting = scroller.current?.querySelector<HTMLButtonElement>('[data-needs-you][tabindex="0"]');
              if (waiting) waiting.focus();
              else if (tabStop) focusItem(tabStop);
            }} />
            {searching && <button type="button" onClick={() => openConversationSearch(query.trim())}
              className="mb-1 w-full rounded-sm px-[9px] py-1.5 text-left text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
              Search in conversations for ‘{query.trim()}’
            </button>}
          </div>
        </SidebarDestinations>
        <HubNotice /* P5 O7 M2 (A2): once, while the hub can't be reached and another machine still is */ />
        <ContextMenu.Root modal={false} onOpenChange={(isOpen) => !isOpen && setMenuTarget(null)}>
          <ContextMenu.Trigger asChild>
            <div
              ref={scroller}
              data-testid="sidebar-tree"
              onContextMenu={(event) => {
                const target = menuTargetOf(event.target as Element);
                if (target) setMenuTarget(target);
                else event.preventDefault(); // no row, no menu
              }}
              className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 [scrollbar-width:thin]"
            >
              <NeedsYou rows={rows} greyed={greyedRows} selected={selected} onEmptyFocus={() => search.current?.querySelector('input')?.focus()} />
              <SectionHeading title="Projects" status={reconnecting ? RECONNECTING : ''}>
                <ProjectFilter projects={allKnownProjects} index={index} current={selectedKey} selected={projectFilter} onChange={setProjectFilter} />
                <SortMenu sort={sidebar.sort} />
                <AddProject />
              </SectionHeading>
              {listEmpty && !reconnecting && <EmptyProjects /* ticket 407: not while this Mac's read is refused */ />}
              {listed.length === 0 ? (
                searching && <p className="m-0 px-[9px] py-1.5 text-ui-sm text-fg-faint">No projects match</p>
              ) : (
                <div role="tree" aria-label="Projects" onKeyDown={onTreeKeyDown} onClickCapture={() => setPicked(null)} /* a listed row picks itself after this */ className="flex flex-col gap-px">
                  {shown.map((group, i) => (
                    <Fragment key={group.entry.key}>
                      {i === moreAt && moreProjects}
                      <ProjectRow entry={group.entry} open={group.open} sessions={group.sessions} more={group.more} hidden={group.hidden} matchCount={searching ? group.sessions.length : undefined} onToggle={toggleProject} onShowMore={showMore} onToggleHidden={toggleHidden} />
                    </Fragment>
                  ))}
                  {moreAt === shown.length && moreProjects}
                </div>
              )}
              {(hiddenProjects.length > 0 || registry.removals.length > 0) && !searching && (
                <button
                  type="button"
                  onClick={() => openDialog({ kind: 'hiddenProjects' })}
                  className="mt-1 flex h-(--row-h) w-full cursor-default items-center rounded-sm pr-[9px] pl-[30px] text-left text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
                >
                  Hidden projects…
                </button>
              )}
              {!searching && (
                <button
                  type="button"
                  onClick={() => openDialog({ kind: 'archived', projectId: null })}
                  className="mt-1 flex h-(--row-h) w-full cursor-default items-center rounded-sm pr-[9px] pl-[30px] text-left text-ui-sm text-fg-muted outline-accent select-none hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
                >
                  Archived sessions…
                </button>
              )}
            </div>
          </ContextMenu.Trigger>
          <SidebarMenuContent target={menuTarget} />
        </ContextMenu.Root>
        <ResumeChooserHost />
      </div>
      </SidebarInteractionContext.Provider>
    </TreeContext.Provider>
  );
}

function holdOrder<T>(current: T[], previous: T[], key: (item: T) => string): T[] {
  const rank = new Map(previous.map((item, index) => [key(item), index]));
  // New arrivals follow the held rows; stable sort keeps the arrivals' live ordering.
  return [...current].sort((a, b) => (rank.get(key(a)) ?? previous.length) - (rank.get(key(b)) ?? previous.length));
}

const SORTS: { value: SidebarSort; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'recency', label: 'Recency' },
];

// The order of each project's sessions, on the Projects heading (W11; it sat on W5's project page).
function SortMenu({ sort }: { sort: SidebarSort }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Sort sessions" className="size-[22px]">
          <SortIcon className="size-[13px]" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-36 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-muted">Sort sessions by</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={sort} onValueChange={(value) => useLayout.getState().setSidebar({ sort: value as SidebarSort })}>
            {SORTS.map(({ value, label }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover"
              >
                <span className="w-3 text-accent">
                  <DropdownMenu.ItemIndicator>●</DropdownMenu.ItemIndicator>
                </span>
                {label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// New chat (M2): directly under the sidebar wordmark, above the search and tree, as Codex's first nav row sits above its
// projects (readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:519957-519987, 520284-520293). It
// is `newChat` (U13a): in the current project, else in none ("Choose a project").
function SidebarDestinations({ children }: { children: ReactNode }) {
  return <nav aria-label="App destinations" className="shrink-0 px-2.5 pt-2.5 pb-1">
    {children}
    <NewChatRow />
    <DestinationRow kind="projects" />
    <ArtifactsRow />
    <DestinationRow kind="customize" />
  </nav>;
}

// UX wave U7b: a row is current while its page is open.
const isCurrent = (state: LayoutState, page: Destination['kind']): boolean => state.destination?.kind === page;

function DestinationRow({ kind }: { kind: 'projects' | 'customize' }) {
  const current = useLayout((s) => isCurrent(s, kind));
  const label = { projects: 'Projects', customize: 'Customize' }[kind];
  const open = () => { if (kind === 'projects') openProjects(); else openCustomize(); };
  return <button type="button" aria-current={current ? 'page' : undefined} onClick={open}
    className={`flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] text-ui text-fg outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 ${current ? 'bg-bg-active' : ''}`}>
    {kind === 'projects' ? <FolderIcon className="size-[13px]" /> : <CustomizeIcon />}
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
  </button>;
}
const CustomizeIcon = () => <svg viewBox="0 0 16 16" aria-hidden className="size-[13px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.5]">
  <path d="M2 4h3m4 0h5M2 12h7m4 0h1" /><circle cx="7" cy="4" r="2" /><circle cx="11" cy="12" r="2" />
</svg>;

function NewChatRow() {
  const canCreate = useSessionCreatorRegistered();
  const chord = useChordHint('session.new');
  return (
    <button
      type="button"
      aria-label={NEW_CHAT}
      disabled={!canCreate}
      title={canCreate ? (chord ? `${NEW_CHAT} · ${chord}` : NEW_CHAT) : 'Not available here'}
      onClick={() => void newChat()}
      className="group/new flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] text-ui text-fg outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
    >
      <NewChatIcon className="size-[13px]" />
      <span className="min-w-0 flex-1 truncate text-left">{NEW_CHAT}</span>
      {chord && <kbd className="font-ui text-ui-sm text-fg-faint opacity-0 group-hover/new:opacity-100 group-focus-visible/new:opacity-100">{chord}</kbd>}
    </button>
  );
}

// A pencil over a square, the new-chat glyph (tokens only: it draws in the current colour).
const NewChatIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5] ${className ?? ''}`}>
    <path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
    <path d="M11.5 2.5l2 2L8 10H6V8z" />
  </svg>
);

// P3-G (§D5): Artifacts, under New chat in its row style, opens or activates the singleton Artifacts tab (the action
// `artifacts.open` does the same from the palette and the View menu); it reads as the current page while that tab is
// the one shown.
function ArtifactsRow() {
  const current = useLayout((s) => isCurrent(s, 'library'));
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={openArtifacts}
      className={`flex h-(--row-h) w-full cursor-default items-center gap-[7px] rounded-sm pr-1 pl-[9px] text-ui text-fg outline-accent select-none hover:bg-bg-hover focus-visible:outline-2 ${current ? 'bg-bg-active' : ''}`}
    >
      <ArtifactsIcon className="size-[13px]" />
      <span className="min-w-0 flex-1 truncate text-left">Artifacts</span>
    </button>
  );
}

// A grid of four squares, the library's glyph (tokens only: it draws in the current colour).
const ArtifactsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={`shrink-0 fill-none stroke-current [stroke-linejoin:round] [stroke-width:1.5] ${className ?? ''}`}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </svg>
);

function EmptyProjects() {
  return <p className="m-0 px-2.5 py-2 text-ui-sm text-fg-muted">No projects yet</p>;
}

// Until both snapshots have loaded: the search field and a few placeholder project rows.
function SidebarSkeleton() {
  return (
    <>
    <SidebarDestinations><div className="mx-0.5 mb-2.5 h-8 rounded-sm border border-border" /></SidebarDestinations>
    <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2.5">
      <SectionHeading title="Projects" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} data-testid="skeleton-row" aria-hidden className="flex h-9 items-center px-[9px]">
          <div className="h-2.5 w-3/5 animate-pulse rounded-sm bg-bg-active motion-reduce:animate-none" />
        </div>
      ))}
    </div>
    </>
  );
}

// UX wave U7b (O-47): the gear alone; the usage reading is the title bar's ring.
function Footer() {
  const settings = useActionEnabled('settings.open'); // C11
  const chord = useChordHint('settings.open'); // C11
  return (
    <footer className="flex min-h-[43px] items-center gap-2 border-t border-border px-4 py-[7px] text-ui-sm text-fg-muted">
      {/* C11 start: the gear opens the Settings tab (settings.open) once C11's handler is registered */}
      <button
        type="button"
        disabled={!settings}
        aria-label="Workspace settings"
        title={settings ? `Settings${chord ? ` · ${chord}` : ''}` : 'Not available here'}
        onClick={() => runAction('settings.open')}
        className="ml-auto inline-flex size-7 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
      >
        <GearIcon />
      </button>
      {/* C11 end */}
    </footer>
  );
}
