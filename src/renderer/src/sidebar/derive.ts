// The sidebar's readings of the stores (§5.1 as amended 2026-10-01, W11; C5 execution document, M3): the project list
// of Codex's flat tree, one expanded project's sessions with their caps, what a row says, and how old it is. Pure, so
// the layout is testable without React.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord, SessionDigest } from '@shared/ipc/schema';
import type { NeedsYouRow } from '../attention/derive';
import { dateFormats, formatAgo } from '@shared/app/date-format';
import { issuedAt, lastActivity, priorityRank, RANK_REST, sortSessions, type SeenActivity, type SidebarSort } from '../overview/derive';
import { branchLabel, recordBranch } from '../sessions/branch-label';
import { workingBranch, workingWorktree } from '@shared/sessions/working-folder'; // UX wave U8c-2
import { displayTitle, listedTitle } from '../sessions/title'; // E3; P5 O7 M6: listedTitle
import { projectLabels } from './project-labels';
import type { MachineRef } from '@shared/machine/ref';
import { isCheckout, machineOfRow, machineOrder, machineProject, orgIndex, primaryCheckout, registryOnly, rowOfListed, rowOfRecord, type OrgProject, type RowKey } from '../stores/org-projects'; // P5 O6 M5; P5 O7 M2: rowOfListedRecord
import type { OrgProjects, RegistryProject } from '../stores/registry'; // the project registry
import { machineOf } from '@shared/machine/address';
import type { ListedSession } from '../stores/sessions'; // P5 O8 M2
import { SIDE_COPY } from '../side/copy'; // E3
import { isWorking, listedStateOf } from '../sessions/listed-state'; // P5 O7 M10

// P5 O6 M5: a row is an org project's, keyed by its org key (an address while its machine has not derived it), or a
// machine's own project's (`machine:<ref>`), which took the place of "Other sessions": one per machine, after the
// projects (`stores/org-projects.ts`).
export type ProjectKey = RowKey;

// Case-insensitive substring over the title, the project's name, the directory and the branch (P2-D, G2: the branch the
// record names, W9's rule). The ⌘K palette and the resume chooser search sessions with the same rule, so the sidebar's
// filter, the palette and the chooser agree on what a query finds.
export function sessionMatcher(query: string, projects: ReadonlyMap<ProjectId, ProjectRecord>): (record: SessionRecord) => boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return () => true;
  return (record) =>
    record.title.text.toLowerCase().includes(q) ||
    record.directory.toLowerCase().includes(q) ||
    (record.projectId !== null && (projects.get(record.projectId)?.name.toLowerCase().includes(q) ?? false)) ||
    [recordBranch(record), workingBranch(record)].some((branch) => branchLabel(branch)?.toLowerCase().includes(q) ?? false); // P2-D; UX wave U8c-2 (fix wave 1): the branch the record shows (the Resume picker's) and the working folder's
}

// P5 O8 M2: a listed row's title (`sessions/title.ts`); the search matches a listed row by its title alone.
export { listedTitle };
export function listedMatcher(query: string): (listed: ListedSession) => boolean {
  const q = query.trim().toLowerCase();
  return q === '' ? () => true : (listed) => listedTitle(listed).toLowerCase().includes(q);
}
// A listed row's last activity (`overview/derive.ts`, beside a record's).
export { issuedAt };

// ---- the project list --------------------------------------------------------------------------------------------------

export interface ProjectListInput {
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  projects: ReadonlyMap<ProjectId, ProjectRecord>; // every machine's, hidden and discovered ones included
  rows: NeedsYouRow[]; // the Needs-you rows: a project's waiting count is how many of its sessions have one
  local: MachineRef;
  machineName(machine: MachineRef): string;
  alsoListed?: ReadonlySet<ProjectKey>; // keys listed for the moment though no checkout lists them (the project filter's)
  listed?: ReadonlyMap<AppSessionId, ListedSession>; // P5 O8 M2: other machines' listed sessions (the sessions store's)
  people?: ReadonlySet<ProjectKey>; // P5 O8 M5: the rows whose People toggle is on (`stores/people.ts`)
  seen?: SeenActivity; // P5 O7 M10: a remote record's activity beyond the record (`seenActivity`), for its row's order
  registry?: OrgProjects; // the project registry (Interfaces §J): its row keys, names and locations (the sessions store's)
}

export interface ProjectEntry {
  key: ProjectKey;
  org: OrgProject;
  project: ProjectRecord | null; // the checkout the row's actions and card act on (`primaryCheckout`); null for a machine's row
  machine: MachineRef | null; // a machine row's machine; null for an org project's
  name: string;
  sessions: SessionRecord[]; // not archived, unsorted
  listed: ListedSession[]; // P5 O8 M2: the listed rows drawn under it, unsorted
  rollup: { waiting: number; working: number }; // P5 O8 M5: yours only
  lastActivity: number | null; // W11 (I6): the latest movement of any of its drawn sessions, archived ones included; null without one
  others: number; // P5 O8 M5: other people's sessions filed under it and not drawn (its People toggle is off)
  // the project registry (§J): the registry's project the row is, and the machines its folders are on, this Mac's first
  // (its locations as the registry says them, and the checkouts of machines that answer their own projects)
  registry: RegistryProject | null;
  machines: MachineRef[];
}

// P5 O6 M5: every listed org project, then each machine's own project that holds a session (T3: named after the machine,
// the local machine's first, then by name), each with its sessions from every machine, its waiting (◐) and working (●)
// counts and its last activity; a hidden project's sessions are in none. Org projects are sorted by recency of activity:
// the latest movement of any of their sessions (archived ones included, so archiving does not demote a project), one
// without sessions by when its checkout was added; ties by its checkout's order, then the name.
//
// P5 O8 M2 ("Drawing", membership): another machine's listed session the member owns joins the row `rowOfListed` files it
// under, unless a record holds its address (the yield rule: the record's row is drawn); its issue counts as activity, and
// a listed row waiting or busy adds to the counts. P5 O7 M2: a record at a listed address is filed where its listing is,
// so the row stands still: another machine's (a lane B session main read over its link) always, this Mac's while its
// project is not known here (`rowOfRecord`).
//
// P5 O8 M5 ("The People toggle"): ownership comes first. An address, a record's or a listing's, is others' when a listing
// at it exists and isn't the member's, and yours otherwise (a record carries no owners). Filed as above, others' rows are
// drawn only under a row whose People toggle is on (`people`), else counted in its `others`, so a record a lane opened of
// someone else's session leaves the list with the toggle. Drawn, they count as activity but never in the rollups, which
// say what needs you; a machine's row with others' sessions alone is kept, so its "+N others" and toggle stay reachable.
export function projectList({ records, digests, projects, rows, local, machineName, alsoListed, listed: remoteSessions = new Map(), people = new Set(), seen, registry }: ProjectListInput): ProjectEntry[] {
  const index = orgIndex(projects.values(), local, registry);
  const waiting = new Set(rows.map((row) => row.appSessionId));
  const grouped = new Map<ProjectKey, { live: SessionRecord[]; listed: ListedSession[]; activity: number; theirs: Set<AppSessionId>; others: number }>();
  const groupOf = (key: ProjectKey) => {
    let entry = grouped.get(key);
    if (!entry) grouped.set(key, (entry = { live: [], listed: [], activity: Number.NEGATIVE_INFINITY, theirs: new Set(), others: 0 }));
    return entry;
  };
  const isTheirs = (appId: AppSessionId) => remoteSessions.get(appId)?.mine === false;
  for (const record of records.values()) {
    const key = rowOfRecord(index, projects, record, remoteSessions, alsoListed); // P5 O7 M2: one row per address
    if (key === null) continue; // a hidden project's: nowhere
    const entry = groupOf(key);
    if (isTheirs(record.appId)) {
      if (!people.has(key)) {
        if (!record.archived) entry.others++;
        continue;
      }
      entry.theirs.add(record.appId);
    }
    entry.activity = Math.max(entry.activity, lastActivity(record, digests.get(record.appId), seen?.get(record.appId)));
    if (!record.archived) entry.live.push(record);
  }
  for (const session of remoteSessions.values()) {
    if (records.has(session.appId)) continue; // the record's row is drawn (or counted) in its place
    const key = rowOfListed(index, session, alsoListed);
    if (key === null) continue; // an all-hidden project's: nowhere
    const entry = groupOf(key);
    if (!session.mine) {
      if (!people.has(key)) {
        entry.others++;
        continue;
      }
      entry.theirs.add(session.appId);
    }
    entry.activity = Math.max(entry.activity, issuedAt(session));
    entry.listed.push(session);
  }
  const listedKeys = [...index.orgs.keys()].filter((key) => index.listed.has(key) || alsoListed?.has(key));
  const primaries = new Map(listedKeys.flatMap((key) => {
    const primary = primaryCheckout(index, key, local);
    return primary ? [[key, primary] as const] : [];
  }));
  const labels = projectLabels([...primaries.values()].map((p) => ({ ...p, name: index.orgs.get(index.keyOf(p))!.name })));
  // the project registry: the machines a row's folders are on, this Mac's first
  const byMachine = machineOrder(local, machineName);
  const machinesOf = (key: ProjectKey): MachineRef[] => {
    const org = index.orgs.get(key);
    const held = [...(org?.registry?.locations.map((l) => l.machine) ?? []), ...(index.projects.get(key) ?? []).filter((p) => isCheckout(p) && !p.hidden).map((p) => machineOf(p.id))];
    return [...new Set(held)].sort(byMachine);
  };
  // a row's latest drawn movement; null with none (others' rows the toggle hides leave a group with no activity)
  const entryActivity = (key: ProjectKey): number | null => {
    const activity = grouped.get(key)?.activity;
    return activity !== undefined && Number.isFinite(activity) ? activity : null;
  };
  const entryOf = (org: OrgProject, project: ProjectRecord | null, machine: MachineRef | null, name: string): ProjectEntry => {
    const group = grouped.get(org.id);
    const sessions = group?.live ?? [];
    const remote = group?.listed ?? [];
    const yours = (id: AppSessionId) => !group?.theirs.has(id);
    const count = (state: string) => remote.filter((l) => l.state === state && yours(l.appId)).length;
    const said = (r: SessionRecord) => listedStateOf(digests.get(r.appId), remoteSessions.get(r.appId)); // P5 O7 M10: a remote lane B record's listing
    return {
      key: org.id,
      org,
      project,
      machine,
      name,
      registry: org.registry ?? null,
      machines: machine === null ? machinesOf(org.id) : [machine],
      sessions,
      listed: remote,
      rollup: {
        waiting: sessions.filter((r) => yours(r.appId) && (waiting.has(r.appId) || said(r) === 'waiting')).length + count('waiting'),
        working: sessions.filter((r) => yours(r.appId) && isWorking(digests.get(r.appId), remoteSessions.get(r.appId))).length + count('busy'),
      },
      lastActivity: entryActivity(org.id),
      others: group?.others ?? 0,
    };
  };
  // this app's machines' rows by recency, as before; then (the project registry, provisionally: Plan of Work, M11) the rows
  // whose folders only the registry names, none on a machine that answers its own projects, by name
  const here = [...primaries]
    .filter(([key]) => !registryOnly(index, key))
    .map(([key, project]) => ({ entry: entryOf(index.orgs.get(key)!, project, null, labels.get(project.id)!), activity: entryActivity(key) ?? Date.parse(project.createdAt) }))
    .sort((a, b) => b.activity - a.activity || a.entry.project!.order - b.entry.project!.order || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
  const elsewhere = listedKeys
    .filter((key) => registryOnly(index, key))
    .map((key) => {
      const primary = primaries.get(key) ?? null;
      return entryOf(index.orgs.get(key)!, primary, null, primary === null ? index.orgs.get(key)!.name : labels.get(primary.id)!);
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const listed = [...here, ...elsewhere];
  const machines = [...new Set([...grouped.keys()].map(machineOfRow).filter((m) => m !== null))].sort(machineOrder(local, machineName));
  const own = machines.map((machine) => entryOf(machineProject(machine, machineName(machine)), null, machine, machineName(machine))).filter((entry) => entry.sessions.length > 0 || entry.listed.length > 0 || entry.others > 0);
  return [...listed, ...own];
}


// The list while searching: the org projects whose name matches, and every row holding a session that matches.
export function filterProjectList<E extends ProjectEntry>(entries: E[], query: string, projects: ReadonlyMap<ProjectId, ProjectRecord>): E[] {
  const q = query.trim().toLowerCase();
  if (q === '') return entries;
  const matches = sessionMatcher(query, projects);
  const matchesListed = listedMatcher(query);
  return entries.filter((e) => (e.machine === null && e.name.toLowerCase().includes(q)) || e.sessions.some(matches) || e.listed.some(matchesListed));
}

// The projects in order of recency, as the sidebar ranks its rows (a New chat's project picker): the latest movement of
// any of a project's sessions, else when it was added; ties by its order, then its name.
export function projectsByRecency(records: ReadonlyMap<AppSessionId, SessionRecord>, digests: ReadonlyMap<AppSessionId, SessionDigest>, projects: readonly ProjectRecord[]): ProjectRecord[] {
  const activity = new Map<ProjectId, number>();
  for (const record of records.values()) {
    if (record.projectId === null) continue;
    activity.set(record.projectId, Math.max(activity.get(record.projectId) ?? Number.NEGATIVE_INFINITY, lastActivity(record, digests.get(record.appId))));
  }
  const at = (p: ProjectRecord) => activity.get(p.id) ?? Date.parse(p.createdAt);
  return [...projects].sort((a, b) => at(b) - at(a) || a.order - b.order || a.name.localeCompare(b.name));
}

// ---- an expanded project's sessions ------------------------------------------------------------------------------------

// Codex's shape, as the owner corrected it (waves plan §2 I4, 2026-10-01): five project rows by recency, then "Show
// more" for the rest (Codex's `maxGroups={5}`, readable/chatgpt-26.928.40906/renderer/app/app-initial-27bc4044d9e8.js:547146);
// an expanded project's five sessions (`maxItems={ncs}`, `ncs = 5`, :545584), then "Show more" to eight at most, never
// more (Codex adds ten per click; the owner capped it). Whatever lies
// past eight is the Resume… picker's (I7), reached from the project row, so a project never takes the list over.
export const PROJECTS_FIRST = 5;
export const SESSIONS_FIRST = 5;
export const SESSIONS_CAP = 8;

// How many of `total` sessions an expanded project shows, before and after its "Show more".
export const shownCount = (total: number, more: boolean): number => Math.min(total, more ? SESSIONS_CAP : SESSIONS_FIRST);

// P5 O7 M8, the spawned-here lead (the architect's ruling of 2026-11-04, made in the owner's place; the owner can
// overrule it): a session spawned from this window, on any machine, leads its group under the pinned records (a pin is
// the person's own order, the lead the app's inference) whatever the sort, and is never cut by the group's cap
// (`shownTrees`), until its first turn ends (`sessions/spawned-here.ts` keeps the set and ends each lead). The one
// predicate the sidebar's order and caps read it through, so overruling it is this line.
export const leadsAsSpawned = (id: AppSessionId, spawned: ReadonlySet<AppSessionId> | undefined): boolean => spawned?.has(id) ?? false;

export interface ProjectSessionsInput {
  sessions: readonly SessionRecord[]; // the project's sessions, not archived
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  rows: NeedsYouRow[];
  sort: SidebarSort;
  matches: (record: SessionRecord) => boolean;
  spawned?: ReadonlySet<AppSessionId>; // P5 O7 M8: the sessions spawned here that still lead (`leadsAsSpawned`)
  seen?: SeenActivity; // P5 O7 M10: a remote record's activity beyond the record (`seenActivity`)
  listings?: ReadonlyMap<AppSessionId, ListedSession>; // P5 O7 M10: the sessions store's listings, a remote lane B record's state (`listedStateOf`)
  now: number; // P5 O7 M10's follow-up: the clock an unread session's freshness is judged at (`priorityRank`)
}

// One flat list: pinned sessions first (pin keeps a session at the top of its project), then a session spawned here
// that still leads (P5 O7 M8), then the rest in the chosen sort; worktree sessions sit among them, marked by their branch
// (`rowBranch`).
export function projectSessions({ sessions, digests, rows, sort, matches, spawned, seen, listings, now }: ProjectSessionsInput): SessionRecord[] {
  const order = (list: SessionRecord[]) => sortSessions(list, sort, { digests, rows, seen, listings, now });
  const shown = sessions.filter(matches);
  const leads = (r: SessionRecord) => !r.pinned && leadsAsSpawned(r.appId, spawned);
  return [...order(shown.filter((r) => r.pinned)), ...order(shown.filter(leads)), ...order(shown.filter((r) => !r.pinned && !leads(r)))];
}

// E3 start: the lineage forest (E3 execution document, Design §6, M4's decisions). A project's sorted sessions become
// trees: a record whose lineage parent is in the list is nested under it (siblings by `createdAt`, a child's own
// children after it, depth first); one whose parent is absent (archived, searched away, in another project) stays a
// root where it sorted. The caps count trees, each shown whole.
export interface SessionTreeRow {
  record: SessionRecord;
  nestedUnder: AppSessionId | null; // the parent it is drawn under; null for a root
  depth: number; // 0 for a root, its parent's plus one below it (the tree's real depth; the row's indent is capped)
}
export interface SessionTree {
  root: SessionRecord;
  rows: SessionTreeRow[]; // the root, then its descendants depth first
}

export function nestLineage(sorted: readonly SessionRecord[]): SessionTree[] {
  const listed = new Set(sorted.map((r) => r.appId));
  const parentOf = (record: SessionRecord): AppSessionId | null => {
    const parent = record.lineage?.parentAppSessionId;
    return parent !== undefined && parent !== record.appId && listed.has(parent) ? parent : null;
  };
  const children = new Map<AppSessionId, SessionRecord[]>();
  for (const record of sorted) {
    const parent = parentOf(record);
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), record]);
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const placed = new Set<AppSessionId>();
  const grow = (record: SessionRecord, nestedUnder: AppSessionId | null, depth: number, rows: SessionTreeRow[]) => {
    placed.add(record.appId);
    rows.push({ record, nestedUnder, depth });
    for (const child of children.get(record.appId) ?? []) if (!placed.has(child.appId)) grow(child, record.appId, depth + 1, rows);
  };
  const trees: SessionTree[] = [];
  const plant = (record: SessionRecord) => {
    const rows: SessionTreeRow[] = [];
    grow(record, null, 0, rows);
    trees.push({ root: record, rows });
  };
  for (const record of sorted) if (parentOf(record) === null) plant(record);
  for (const record of sorted) if (!placed.has(record.appId)) plant(record); // a lineage cycle: never lose a record
  return trees;
}

// What a lineage row says after its title, in place of the branch: nested under its parent, the anchor's label unless
// the title is that already (a side thread is named by it, Design §3); a thread or fork listed as a root, whose it is.
export function lineageCaption(record: SessionRecord, nested: boolean, parentTitle: string | null): string | null {
  const lineage = record.lineage;
  if (lineage === null) return null;
  if (!nested) return SIDE_COPY.lineage.orphan(lineage.kind, parentTitle);
  const label = lineage.kind === 'side-thread' ? (lineage.anchor?.label ?? null) : null;
  return label !== null && label !== displayTitle(record) ? label : null;
}
// E3 end

// P5 O8 M2 ("Drawing", membership): an expanded project's records and listed rows in one ordering, under the same caps
// and Show more. P5 O7 M8 (*The sidebar row*, parity): a listed row ranks by its own state, as a record does. First
// pinned records, then a session spawned here that still leads (`leadsAsSpawned`); under `priority`, a Needs-you row (a
// listed row's from its machine's attention feed, in the rows' order: a waiting word with no feed row is the rest's,
// a record's digest and a listing's alike), unread records, the working (a record by its turn start, a listed row `busy` by its listing's issue: sminos re-issues
// a listing at each change of its state), then the rest by last activity (a record's `lastActivity`, a listed row's
// `issued`); under `recency`, all by last activity. Lineage nests records only; a listed row is a tree of one.
export type SidebarSession = { kind: 'record'; record: SessionRecord } | { kind: 'listed'; listed: ListedSession };
export interface ListedTreeRow {
  listed: ListedSession;
  nestedUnder: null;
  depth: 0;
}
export type SidebarTreeRow = SessionTreeRow | ListedTreeRow;
export interface SidebarTree {
  root: SidebarSession;
  rows: SidebarTreeRow[];
}
export const isListedRow = (row: SidebarTreeRow): row is ListedTreeRow => 'listed' in row;
export const sidebarSessionId = (session: SidebarSession): AppSessionId => (session.kind === 'record' ? session.record.appId : session.listed.appId);

export interface ProjectItemsInput {
  sorted: readonly SessionRecord[]; // `projectSessions`'s order
  listed: readonly ListedSession[];
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  rows: NeedsYouRow[];
  sort: SidebarSort;
  spawned?: ReadonlySet<AppSessionId>; // P5 O7 M8: as `projectSessions` was given it
  seen?: SeenActivity; // P5 O7 M10: as `projectSessions` was given it
  listings?: ReadonlyMap<AppSessionId, ListedSession>; // P5 O7 M10: as `projectSessions` was given it
  now: number; // as `projectSessions` was given it
}

// An item's place: its tier (-2 pinned, -1 the spawned lead, then `priorityRank`'s groups), its key within a ranked
// group, and its last activity, which orders the pinned, the lead and the rest.
interface Rank { tier: number; key: number; at: number }
const PINNED_TIER = -2;
const SPAWNED_TIER = -1;
const byRank = (a: Rank, b: Rank): number => a.tier - b.tier || (a.tier < 0 || a.tier === RANK_REST ? b.at - a.at : a.key - b.key);

export function projectItems({ sorted, listed, digests, rows, sort, spawned, seen, listings, now }: ProjectItemsInput): SidebarSession[] {
  const rowIndex = new Map(rows.map((row, i) => [row.appSessionId, i]));
  const recordRank = (r: SessionRecord): Rank => {
    const digest = digests.get(r.appId);
    const at = lastActivity(r, digest, seen?.get(r.appId));
    if (r.pinned) return { tier: PINNED_TIER, key: 0, at };
    if (leadsAsSpawned(r.appId, spawned)) return { tier: SPAWNED_TIER, key: 0, at };
    const [tier, key] = sort === 'priority' ? priorityRank(r, digest, rowIndex.get(r.appId), now, seen?.get(r.appId), listings?.get(r.appId)) : [RANK_REST, 0];
    return { tier, key, at };
  };
  const listedRank = (l: ListedSession): Rank => {
    const at = issuedAt(l);
    if (leadsAsSpawned(l.appId, spawned)) return { tier: SPAWNED_TIER, key: 0, at };
    if (sort !== 'priority') return { tier: RANK_REST, key: 0, at };
    const row = rowIndex.get(l.appId);
    if (row !== undefined) return { tier: 0, key: row, at };
    if (l.state === 'busy') return { tier: 2, key: -at, at };
    return { tier: RANK_REST, key: 0, at };
  };
  const remote = listed.map((l) => ({ l, rank: listedRank(l) })).sort((a, b) => byRank(a.rank, b.rank) || listedTitle(a.l).localeCompare(listedTitle(b.l)));
  // the records keep `sorted`'s order, which ranks them on the same scale; the listed rows merge in, a tie the record's
  const out: SidebarSession[] = [];
  let j = 0;
  for (const record of sorted) {
    const rank = recordRank(record);
    for (; j < remote.length && byRank(remote[j].rank, rank) < 0; j++) out.push({ kind: 'listed', listed: remote[j].l });
    out.push({ kind: 'record', record });
  }
  for (; j < remote.length; j++) out.push({ kind: 'listed', listed: remote[j].l });
  return out;
}

// The trees an expanded project draws (search aside): the first `shownCount`, then any tree holding a row that still
// leads as spawned here past them, its root or a row nested under it (a side thread's child under an older parent)
// (P5 O7 M8, the architect's ruling: the lead is never cut, the cap grows by one), and how many more "Show more" would
// draw.
export function shownTrees(trees: readonly SidebarTree[], more: boolean, spawned: ReadonlySet<AppSessionId> | undefined): { shown: SidebarTree[]; more: number } {
  const count = shownCount(trees.length, more);
  const leads = (tree: SidebarTree) => tree.rows.some((row) => leadsAsSpawned(isListedRow(row) ? row.listed.appId : row.record.appId, spawned));
  const past = trees.slice(count).filter(leads);
  const shown = [...trees.slice(0, count), ...past];
  const withinCap = trees.slice(count, SESSIONS_CAP).filter((tree) => !leads(tree)).length;
  return { shown, more: withinCap };
}

// UX wave U7, O-16 (Interfaces §D): a project's ranked sessions split by the hidden set, after ranking and before the caps,
// so a hidden session still counts in its project's marks and rollups and is absent from the five and the eight.
/** A project's ranked sessions, split by the hidden set: `shown` keeps its order; `hidden` is newest activity first. */
export function splitHidden(items: readonly SidebarSession[], isHidden: (id: AppSessionId) => boolean, activityOf: (item: SidebarSession) => number): { shown: SidebarSession[]; hidden: SidebarSession[] } {
  const shown: SidebarSession[] = [];
  const hidden: SidebarSession[] = [];
  for (const item of items) (isHidden(sidebarSessionId(item)) ? hidden : shown).push(item);
  if (hidden.length === 0) return { shown, hidden };
  const at = new Map(hidden.map((item) => [item, activityOf(item)]));
  return { shown, hidden: hidden.sort((a, b) => at.get(b)! - at.get(a)!) }; // stable: equal activity keeps the rank order
}

// The trees the caps count, in the items' order: each record's lineage tree (`nestLineage`) where its root sits, each
// listed row a tree of one.
export function nestItems(items: readonly SidebarSession[]): SidebarTree[] {
  const trees = new Map(nestLineage(items.flatMap((i) => (i.kind === 'record' ? [i.record] : []))).map((tree) => [tree.root.appId, tree]));
  return items.flatMap((item): SidebarTree[] => {
    if (item.kind === 'listed') return [{ root: item, rows: [{ listed: item.listed, nestedUnder: null, depth: 0 }] }];
    const tree = trees.get(item.record.appId);
    return tree ? [{ root: item, rows: tree.rows }] : [];
  });
}

// ---- row text ----------------------------------------------------------------------------------------------------------

// A worktree session's branch (C10's record, else the index's), as its row's ⎇ label and its hover card name it; null
// for a session in the project directory and for a worktree whose record names none (W9, H2: the record cannot tell a
// detached checkout). UX wave U8c-2 (M4 decision 11): the linked worktree the agent works in and its recorded branch.
export function rowBranch(record: SessionRecord): string | null {
  if (workingWorktree(record) === null) return null;
  return branchLabel(workingBranch(record));
}

// A row's age, compact in the display locale (`@shared/app/date-format`): now, 2m, 2h, 3d, 1w.
export const formatAge = (ms: number): string => dateFormats().age(ms);

// A working session is "now"; otherwise the age of its last activity (P5 O7 M10: `seen` included, a remote record's;
// `listed`, its listing, which says whether it works).
export function sessionAge(record: SessionRecord, digest: SessionDigest | null | undefined, now: number, seen?: number, listed?: ListedSession): string {
  if (isWorking(digest, listed)) return formatAge(0);
  return formatAge(now - lastActivity(record, digest, seen));
}

// A waiting request shows how long its item has waited (the request preview, C7's card).
export const needsYouAge = (oldest: AttentionItem, now: number): string => formatAge(now - Date.parse(oldest.createdAt));

// E11 F2b (plan 2.4): an outcome (a failed turn, an interruption) says when it happened; anything else waits on an answer and says for how
// long ("waiting 5m").
const OUTCOMES: ReadonlySet<AttentionItem['kind']> = new Set(['error', 'interrupted']);
export const itemAge = (item: AttentionItem, now: number): string =>
  OUTCOMES.has(item.kind) ? formatAgo(Math.max(0, now - Date.parse(item.createdAt))) : `waiting ${needsYouAge(item, now)}`;
