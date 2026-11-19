// The ⌘K palette (charter §5.8; C5 execution document, M5; residue *Command palette*): one searchable list of sessions,
// projects and every action of the table, in a Radix Dialog with cmdk for the combobox and its keyboard. Sessions are
// found with the sidebar search's own rule (title, project name, directory), so the two agree. ⏎ opens a session in
// the focused pane and ⌘⏎ in the split; a project is revealed in the sidebar; an action runs through `runAction`.
// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "Search"): "Conversations" asks this Mac and each
// RL2 machine that is up (`search.ts`) and draws each machine's hits under its name ("Sessions" while only this Mac has
// any); another machine's hit with no record is its listed row. A listed session opens through its lane's opener.
// UX wave U11a M5 (S-10; its execution document's Interfaces §F): "Channels", after Projects, lists "<project> · channel"
// for each project that has one, with what waits in it; Enter opens its tab or brings it forward.
// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M4; Interfaces §E; decisions 18
// to 22; S5; P9): with nothing typed the palette opens on "Recent" (`recent.ts`), then Projects, Channels and Actions;
// with text typed it lists Sessions, the Library's matches under "Artifacts" (`artifacts.ts`, one group per machine by
// name when more than one has any), Projects, Channels and Actions, and ends on "Search the Library for “…”". What the
// rules admit is ordered by the `@` menu's scorer over the title. A row is listed only when it can run: listable, and
// with a handler; nothing is drawn greyed.
import { useDialogFocus } from '../app/dialog-focus';
import { Command } from 'cmdk';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { fuzzyScore } from '@shared/composer/fuzzy';
import { ACTIONS, effectiveChord, idsOf, type ActionId, type ActionTable } from '@shared/keymap/actions';
import { formatChord } from '@shared/keymap/chord';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor, listedGlyph } from '../attention/glyph';
import { enabledActions, runAction, subscribeActions } from '../keymap/actions-runtime';
import { modalHandoff } from '../keymap/modal-handoff';
import { useVisits } from '../keymap/visits'; // U6b-5a M4
import { KindIcon } from '../library/icons'; // U6b-5a M4
import { setLibraryView } from '../library/view'; // U6b-5a M4
import { openArtifacts } from '../main/artifacts'; // U6b-5a M4
import { lastActivity } from '../overview/derive'; // U6b-5a M4: Recent's fill
import { sessionMatcher } from '../sidebar/derive';
import { revealProject } from '../sidebar/reveal';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { selectSeenAt, useSessions, type ListedSession } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { ipc } from '../ipc/client';
import { useNow } from '../app/use-now';
import { formatAge, sessionAge } from '../sidebar/derive';
import { displayTitle, listedTitle } from '../sessions/title';
import { openListed } from '../sessions/remote-openers'; // P5 O7 M6
import { useMachines } from '../stores/machines'; // P5 O7 M6
import { machineName } from '../stores/org-projects'; // P5 O7 M6
import type { MachineRef } from '@shared/machine/ref';
import { conversationSnippet } from './snippet';
import { searchConversations, searchedMachines, type ConversationSearch } from './search'; // P5 O7 M6
import { openPaletteArtifact, searchArtifacts, type ArtifactSearch } from './artifacts'; // U6b-5a M4
import { artifactKey, recentRows, type RecentRow } from './recent'; // U6b-5a M4
import { CHANNEL } from '../channel/copy'; // U11a M5
import { openProjectChannel, usePaletteChannels } from '../channel/open-action'; // U11a M5

export const usePalette = create<{ open: boolean; scope: 'all' | 'sessions'; query: string }>()(() => ({ open: false, scope: 'all', query: '' }));
export const openPalette = (query = '') => usePalette.setState({ open: true, scope: 'all', query });
export const togglePalette = () => {
  // Menu accelerators arrive outside React's key handler. A focused sidebar field carries its query into ⌘K too.
  const field = document.activeElement;
  const query = field instanceof HTMLInputElement && field.hasAttribute('data-palette-query') ? field.value : '';
  usePalette.setState((state) => ({ open: !state.open, scope: 'all', query }));
};
const closePalette = () => usePalette.setState({ open: false });
export const openConversationSearch = (query = '') => usePalette.setState({ open: true, scope: 'sessions', query });

export interface PaletteEntries {
  sessions: SessionRecord[];
  projects: ProjectRecord[];
  channels: { project: string; name: string; waiting: number }[]; // U11a M5
  actions: ActionId[];
}

export function paletteEntries(
  query: string,
  input: { records: ReadonlyMap<AppSessionId, SessionRecord>; projects: ReadonlyMap<ProjectId, ProjectRecord>; channels?: PaletteEntries['channels'] },
  table: ActionTable = ACTIONS,
): PaletteEntries {
  const q = query.trim().toLowerCase();
  const matches = sessionMatcher(query, input.projects);
  return {
    sessions: ranked([...input.records.values()].filter((r) => !r.archived && matches(r)), query, (r) => r.title.text),
    projects: ranked([...input.projects.values()].filter((p) => !p.hidden && (q === '' || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q))), query, (p) => p.name), // W11: a hidden project is not revealed
    channels: (input.channels ?? []).filter((c) => CHANNEL.title(c.name).toLowerCase().includes(q)), // U11a M5: "<name> · channel"
    actions: ranked(idsOf(table).filter((id) => listable(id, table) && (q === '' || table[id].title.toLowerCase().includes(q))), query, (id) => table[id].title),
  };
}

// U6b-5a M4 (P9; Interfaces §E): a row the palette may list. U6a: a fixed row is a key its own editor handles. A renderer
// row of a pane or of the composer is a key the element holding the keyboard handles (`useKeyChord`): the palette, which
// holds the keyboard itself, can never run it, whether or not a handler is registered. The rest is listed while it has a
// handler (`Palette`), so nothing is drawn that cannot run.
export const listable = (id: ActionId, table: ActionTable): boolean => {
  const row = table[id];
  return !row.fixed && !(row.sink === 'renderer' && (row.scope === 'pane' || row.scope === 'composer'));
};

// U6b-5a M4 (decision 19): ranking orders what the rules admit and admits nothing new. Best first by the `@` menu's
// scorer over the title; an entry whose title does not hold the text (a session found by its folder, project or branch
// alone, an artifact by its text) has no score and follows; ties keep the order they came in.
function ranked<T>(items: readonly T[], query: string, titleOf: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...items];
  return items
    .map((item, at) => {
      const title = titleOf(item);
      return { item, at, score: title.toLowerCase().includes(q) ? (fuzzyScore(q, title) ?? -Infinity) : -Infinity };
    })
    .sort((a, b) => (a.score === b.score ? a.at - b.at : b.score - a.score))
    .map(({ item }) => item);
}

// The actions with a handler, re-read when a registration changes (the key is a string, so a snapshot is stable).
const handledKey = (): string => enabledActions().sort().join('\n');
function useHandled(): ReadonlySet<string> {
  const key = useSyncExternalStore(subscribeActions, handledKey);
  return new Set(key.split('\n'));
}

// U6b-5a M4: the words of the palette's new groups and its last row (the execution document, "The sentences a person reads").
const PALETTE = {
  recent: 'Recent',
  artifacts: 'Artifacts',
  artifactsOn: (machine: string) => `Artifacts · ${machine}`,
  searchLibrary: (text: string) => `Search the Library for “${text}”`,
};

// Bound item registration and subscriptions; filtering still searches the complete index.
const RESULT_LIMIT = 50;

// P5 O7 M6: one machine's hits as the palette draws them, each a record (not archived) or, wanting one, a listed row.
type HitEntry = { appId: AppSessionId; snippet: string | null } & ({ kind: 'record'; record: SessionRecord } | { kind: 'listed'; listed: ListedSession });
interface HitGroup { machine: MachineRef; entries: HitEntry[] }

function hitGroups(search: ConversationSearch, records: ReadonlyMap<AppSessionId, SessionRecord>, listed: ReadonlyMap<AppSessionId, ListedSession>): HitGroup[] {
  return search.groups
    .map(({ machine, hits }) => ({
      machine,
      entries: hits.flatMap(({ appSessionId: appId, snippet }): HitEntry[] => {
        const record = records.get(appId);
        if (record) return record.archived ? [] : [{ appId, snippet, kind: 'record', record }];
        const row = listed.get(appId);
        return row ? [{ appId, snippet, kind: 'listed', listed: row }] : [];
      }),
    }))
    .filter((group) => group.entries.length > 0);
}

// The value cmdk selects each kind of row by (U6b-5a M4: the selection's first row is read from the same values).
const ROW = {
  session: (appSessionId: AppSessionId) => `session:${appSessionId}`,
  artifact: (machine: MachineRef, artifactId: string) => `artifact:${artifactKey(machine, artifactId)}`,
  project: (projectId: ProjectId) => `project:${projectId}`,
  channel: (project: string) => `channel:${project}`,
  action: (id: ActionId) => `action:${id}`,
  library: 'library:search',
};

// cmdk's keys that move the selection (its arrows, Home and End, and its Ctrl bindings, `vimBindings`).
const movesSelection = (event: KeyboardEvent) =>
  ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (event.ctrlKey && ['j', 'k', 'n', 'p'].includes(event.key));

const ITEM = 'flex h-(--row-h) cursor-default items-center gap-2 rounded-sm px-2 text-ui data-[selected=true]:bg-bg-hover';
const GROUP = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-ui-sm [&_[cmdk-group-heading]]:text-fg-muted';

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const focus = useDialogFocus();
  // UX wave U6b-3b (Decision Log 16): the palette holds nothing a person would lose, so it lends itself to an action that
  // moves the keyboard, from its own row and from the menu alike (keymap/modal-handoff.ts)
  const [{ lend, closeThen, closed }] = useState(() => modalHandoff(closePalette));
  const run = (id: ActionId) => {
    // These actions rightly refuse keys from an active modal. A palette selection is an explicit destination: wait
    // for Radix to release the dialog and restore its opener, then navigate from that real shell focus stop. UX wave
    // U6b-3b: Go to file records where the keyboard is for Esc's second step, which is the opener, not the palette's field.
    const afterClose = id === 'sidebar.focus' || id === 'region.focusNext' || id === 'region.focusPrevious' || id === 'files.goToFile';
    if (afterClose) {
      closeThen(() => runAction(id));
      return;
    }
    usePalette.setState({ open: false });
    runAction(id, id === 'tab.select' ? 1 : null);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => usePalette.setState({ open: next })}>
      <Dialog.Portal>
        <Dialog.Content
          {...focus}
          ref={lend}
          onCloseAutoFocus={(event) => {
            focus.onCloseAutoFocus(event);
            closed();
          }}
          aria-describedby={undefined}
          className="fixed top-[16%] left-1/2 z-50 w-[min(560px,90vw)] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-bg-overlay text-fg"
        >
          <VisuallyHidden.Root asChild>
            <Dialog.Title>Command palette</Dialog.Title>
          </VisuallyHidden.Root>
          <Palette run={run} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Palette({ run }: { run(id: ActionId): void }) {
  const query = usePalette((s) => s.query);
  const scope = usePalette((s) => s.scope);
  const setQuery = (query: string) => usePalette.setState({ query });
  const [content, setContent] = useState<{ query: string } & ConversationSearch | null>(null);
  useEffect(() => {
    if (scope !== 'sessions') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const search = () => {
      // P5 O7 M6: this Mac and each RL2 machine up at the time of asking (an indexing machine's retry asks again)
      const machines = searchedMachines(useSessions.getState().listedMachines, useMachines.getState().machines);
      void searchConversations(ipc, query, machines).then((result) => {
        if (cancelled) return;
        setContent({ query, ...result });
        if (result.indexing) timer = setTimeout(search, 1000);
      });
    };
    timer = setTimeout(search, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope]);
  // U6b-5a M4 (decision 21; S5): the Library's matches, asked as conversations are, 150 ms after the last keystroke; an
  // answer for a query that is no longer the query is dropped
  const typed = query.trim() !== '';
  const [found, setFound] = useState<ArtifactSearch | null>(null);
  useEffect(() => {
    if (scope !== 'all' || query.trim() === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const machines = searchedMachines(useSessions.getState().listedMachines, useMachines.getState().machines);
      void searchArtifacts(ipc, query, machines).then((result) => {
        if (!cancelled) setFound(result);
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope]);
  const [selected, setSelected] = useState('');
  const records = useSessions((s) => s.records);
  const listed = useSessions((s) => s.listed); // P5 O7 M6
  const projects = useSessions((s) => s.projects);
  const machines = useMachines((s) => s.machines); // P5 O7 M6
  const channels = usePaletteChannels(); // U11a M5
  const entries = paletteEntries(query, { records, projects, channels });
  const handled = useHandled(); // U6b-5a M4: a row is listed while it has a handler
  const actions = entries.actions.filter((id) => handled.has(id));
  const recent = useRecent(scope === 'all' && !typed); // U6b-5a M4
  const searching = scope === 'sessions' && content?.query !== query;
  const answered = scope === 'sessions' && !searching && content !== null ? content : null;
  const groups = answered === null ? [] : hitGroups(answered, records, listed);
  const local = ipc.localMachine;
  // "Sessions" while only this Mac has hits, as before machines; each machine's name once another's are drawn
  const headingOf = (machine: MachineRef) => (groups.every((g) => g.machine === local) ? 'Sessions' : machineName(machines, machine, local));
  const errorOf = ({ machine, message }: ConversationSearch['errors'][number]) => (machine === local ? message : `${machineName(machines, machine, local)}: ${message}`);
  // U6b-5a M4 (decision 20): one group "Artifacts" while one machine has matches, else one per machine by its name
  const artifactGroups = scope === 'all' && typed && found?.query === query
    ? found.groups.map(({ machine, rows }) => ({ machine, rows: ranked(rows, query, (row) => row.title) })).filter((group) => group.rows.length > 0)
    : [];
  const artifactsHeading = (machine: MachineRef) => (artifactGroups.length > 1 ? PALETTE.artifactsOn(machineName(machines, machine, local)) : PALETTE.artifacts);
  // U6b-5a M4 (S5; Decision Logs 15 (viii) and 16 (i), (ii)): in the All scope, until the person moves the selection (a
  // key, the pointer), it is the first row and follows the first row as answers arrive; from then on it is kept by value.
  // A move is forgotten at every change of the text or the scope. The Conversations scope keeps its selection by value,
  // as before. Enter runs what is selected when it is pressed.
  const firstRow = (() => {
    const [lead] = recent;
    if (lead) return lead.kind === 'session' ? ROW.session(lead.record.appId) : ROW.artifact(lead.machine, lead.artifactId);
    if (typed && entries.sessions[0]) return ROW.session(entries.sessions[0].appId);
    const artifact = artifactGroups[0]?.rows[0];
    if (artifact) return ROW.artifact(artifactGroups[0]!.machine, artifact.id);
    if (entries.projects[0]) return ROW.project(entries.projects[0].id);
    if (entries.channels[0]) return ROW.channel(entries.channels[0].project);
    if (actions[0]) return ROW.action(actions[0]);
    return typed ? ROW.library : null;
  })();
  const listKey = `${scope}\n${query}`;
  const [moved, setMoved] = useState(false);
  const [movedIn, setMovedIn] = useState(listKey);
  if (movedIn !== listKey) {
    setMovedIn(listKey); // a new text or scope: whatever was moved is forgotten
    setMoved(false);
  }
  const value = scope === 'all' && !moved ? (firstRow ?? selected) : selected;
  const close = () => usePalette.setState({ open: false });

  const openSession = (appSessionId: AppSessionId, split: boolean) => {
    close();
    if (!split && openListed(appSessionId)) return; // P5 O7 M6: another machine's listed session, through its lane's opener
    useLayout.getState().openSession(appSessionId, { split });
  };
  const reveal = (projectId: ProjectId) => {
    close();
    revealProject(projectId);
  };
  const openChannelTab = (project: string) => { // U11a M5
    close();
    openProjectChannel(project);
  };
  const openArtifact = (artifactId: string, machine: MachineRef) => { // U6b-5a M4 (decision 22)
    close();
    openPaletteArtifact(artifactId, machine);
  };
  const searchLibrary = () => { // U6b-5a M4: the Library's page on the text typed
    close();
    setLibraryView({ view: 'all', query: query.trim(), kind: null, spaceId: null, machine: null });
    openArtifacts();
  };
  // ⌘⏎ on a session opens it in the split; cmdk leaves a key whose default is already taken.
  const onKeyDown = (event: KeyboardEvent) => {
    if (movesSelection(event)) setMoved(true);
    if (event.key !== 'Enter' || !event.metaKey || !value.startsWith('session:')) return;
    event.preventDefault();
    openSession(value.slice('session:'.length) as AppSessionId, true);
  };

  return (
    <Command label="Command palette" shouldFilter={false} value={value} onValueChange={setSelected} onKeyDown={onKeyDown} loop>
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder={scope === 'sessions' ? 'Search in conversations' : 'Search sessions, projects and actions'}
        maxLength={1000}
        className="h-11 w-full border-b border-border bg-transparent px-3 text-ui text-fg outline-none placeholder:text-fg-faint"
      />
      <div className="flex gap-1 border-b border-border px-2 py-1" aria-label="Search scope">
        {(['all', 'sessions'] as const).map((value) => <button key={value} type="button" aria-pressed={scope === value}
          onClick={() => usePalette.setState({ scope: value })}
          className={`rounded-sm px-2 py-1 text-ui-sm outline-accent focus-visible:outline-2 ${scope === value ? 'bg-bg-active text-fg' : 'text-fg-muted hover:bg-bg-hover'}`}>
          {value === 'all' ? 'All' : 'Conversations'}
        </button>)}
      </div>
      {answered?.indexing && <p role="status" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Indexing conversations… Results will update.</p>}
      {answered?.incomplete && <p role="alert" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Some conversations could not be indexed. Results may be incomplete. Indexing will retry after a restart or when those conversations change.</p>}
      {searching && <p role="status" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Searching conversations…</p>}
      {answered?.errors.map((error) => <p key={error.machine} role="alert" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">{errorOf(error)}</p>)}
      {(scope === 'sessions'
        ? groups.some((g) => g.entries.length >= RESULT_LIMIT)
        : typed && (entries.sessions.length > RESULT_LIMIT || entries.projects.length > RESULT_LIMIT || entries.channels.length > RESULT_LIMIT || artifactGroups.some((g) => g.rows.length > RESULT_LIMIT))) && (
        <p className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Showing the first {RESULT_LIMIT} matches per group. Type to narrow results.</p>
      )}
      <Command.List
        // the pointer selects the row it moves over (cmdk): the person's move
        onPointerMove={(event) => {
          if (event.target instanceof Element && event.target.closest('[cmdk-item]') !== null) setMoved(true);
        }}
        className="max-h-[min(420px,60vh)] overflow-y-auto p-1"
      >
        <Command.Empty className="p-3 text-ui-sm text-fg-muted">Nothing matches</Command.Empty>
        {recent.length > 0 && (
          <Command.Group heading={PALETTE.recent} className={GROUP}>
            {recent.map((row) =>
              row.kind === 'session' ? (
                <SessionItem key={row.record.appId} record={row.record} project={row.record.projectId ? (projects.get(row.record.projectId) ?? null) : null} onOpen={openSession} />
              ) : (
                <ArtifactItem key={artifactKey(row.machine, row.artifactId)} row={row.row} machine={row.machine} onOpen={openArtifact} />
              ),
            )}
          </Command.Group>
        )}
        {scope === 'all' && typed && entries.sessions.length > 0 && (
          <Command.Group heading="Sessions" className={GROUP}>
            {entries.sessions.slice(0, RESULT_LIMIT).map((record) => (
              <SessionItem key={record.appId} record={record} project={record.projectId ? (projects.get(record.projectId) ?? null) : null} onOpen={openSession} />
            ))}
          </Command.Group>
        )}
        {artifactGroups.map(({ machine, rows }) => (
          <Command.Group key={machine} heading={artifactsHeading(machine)} data-artifact-machine={machine} className={GROUP}>
            {rows.slice(0, RESULT_LIMIT).map((row) => (
              <ArtifactItem key={row.id} row={row} machine={machine} onOpen={openArtifact} />
            ))}
          </Command.Group>
        ))}
        {groups.map((group) => (
          <Command.Group key={group.machine} heading={headingOf(group.machine)} data-search-machine={group.machine} className={GROUP}>
            {group.entries.slice(0, RESULT_LIMIT).map((entry) =>
              entry.kind === 'record' ? (
                <SessionItem key={entry.appId} record={entry.record} snippet={entry.snippet} project={entry.record.projectId ? (projects.get(entry.record.projectId) ?? null) : null} onOpen={openSession} />
              ) : (
                <ListedItem key={entry.appId} listed={entry.listed} snippet={entry.snippet} onOpen={openSession} />
              ),
            )}
          </Command.Group>
        ))}
        {scope === 'all' && entries.projects.length > 0 && (
          <Command.Group heading="Projects" className={GROUP}>
            {entries.projects.slice(0, RESULT_LIMIT).map((project) => (
              <Command.Item key={project.id} value={ROW.project(project.id)} onSelect={() => reveal(project.id)} className={ITEM}>
                <span className="truncate">{project.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {scope === 'all' && entries.channels.length > 0 && (
          <Command.Group heading="Channels" className={GROUP}>
            {entries.channels.slice(0, RESULT_LIMIT).map((entry) => (
              <Command.Item key={entry.project} value={ROW.channel(entry.project)} onSelect={() => openChannelTab(entry.project)} className={ITEM}>
                <span data-channel-name className="truncate">{CHANNEL.title(entry.name)}</span>
                {entry.waiting > 0 && <span data-channel-count className="ml-auto shrink-0 text-ui-sm text-fg-muted">{CHANNEL.waitingCount(entry.waiting)}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {scope === 'all' && actions.length > 0 && (
          <Command.Group heading="Actions" className={GROUP}>
            {actions.map((id) => (
              <ActionItem key={id} id={id} onRun={run} />
            ))}
          </Command.Group>
        )}
        {scope === 'all' && typed && (
          <Command.Item value={ROW.library} onSelect={searchLibrary} className={ITEM}>
            <span className="truncate">{PALETTE.searchLibrary(query.trim())}</span>
          </Command.Item>
        )}
      </Command.List>
    </Command>
  );
}

function SessionItem({ record, project, snippet, onOpen }: { snippet?: string | null; record: SessionRecord; project: ProjectRecord | null; onOpen(id: AppSessionId, split: boolean): void }) {
  const now = useNow();
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const seenAt = useSessions((s) => selectSeenAt(s, record.appId)); // P5 O7 M10
  const listing = useSessions((s) => s.listed.get(record.appId)); // P5 O7 M10: a remote lane B record's state (`listedStateOf`)
  const pending = useAttention((s) => selectPendingOf(s, record.appId));
  return (
    <Command.Item value={ROW.session(record.appId)} onSelect={() => onOpen(record.appId, false)} className={`${ITEM} ${snippet ? "h-auto min-h-(--row-h) py-1.5" : ""}`}>
      <GlyphMark glyph={glyphFor(record, digest, pending, listing)} className="w-4 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate">{displayTitle(record)}</span>{snippet && <span className="line-clamp-2 block text-ui-sm text-fg-muted">{conversationSnippet(snippet)}</span>}</span>
      {project && <span className="ml-auto max-w-[30%] shrink-0 truncate text-ui-sm text-fg-muted">{project.name}</span>}
      <span className="shrink-0 text-ui-sm text-fg-faint">{sessionAge(record, digest, now, seenAt, listing)}</span>
    </Command.Item>
  );
}

// P5 O7 M6: another machine's session the search found with no record, drawn from its listing as the sidebar's listed row
function ListedItem({ listed, snippet, onOpen }: { listed: ListedSession; snippet: string | null; onOpen(id: AppSessionId, split: boolean): void }) {
  const now = useNow();
  const pending = useAttention((s) => selectPendingOf(s, listed.appId));
  const issued = Date.parse(listed.issued);
  return (
    <Command.Item value={ROW.session(listed.appId)} onSelect={() => onOpen(listed.appId, false)} className={`${ITEM} ${snippet ? 'h-auto min-h-(--row-h) py-1.5' : ''}`}>
      <GlyphMark glyph={listedGlyph(listed.state, pending)} className="w-4 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate">{listedTitle(listed)}</span>{snippet && <span className="line-clamp-2 block text-ui-sm text-fg-muted">{conversationSnippet(snippet)}</span>}</span>
      <span className="ml-auto shrink-0 text-ui-sm text-fg-faint">{Number.isFinite(issued) ? formatAge(now - issued) : null}</span>
    </Command.Item>
  );
}

function ActionItem({ id, onRun }: { id: ActionId; onRun(id: ActionId): void }) {
  const overrides = useSettings((s) => s.state?.settings.keymap);
  const chord = effectiveChord(id, overrides ?? {});
  return (
    <Command.Item value={ROW.action(id)} onSelect={() => onRun(id)} className={ITEM}>
      <span className="truncate">{ACTIONS[id].title}</span>
      {chord && <kbd className="ml-auto shrink-0 font-ui text-ui-sm text-fg-muted">{formatChord(chord)}</kbd>}
    </Command.Item>
  );
}

// U6b-5a M4: an artifact, in Recent or found by the text typed (with the passage the Library matched, as its rows show it).
function ArtifactItem({ row, machine, onOpen }: { row: LibraryRow; machine: MachineRef; onOpen(artifactId: string, machine: MachineRef): void }) {
  const now = useNow();
  return (
    <Command.Item value={ROW.artifact(machine, row.id)} onSelect={() => onOpen(row.id, machine)} className={`${ITEM} ${row.snippet ? 'h-auto min-h-(--row-h) py-1.5' : ''}`}>
      <KindIcon kind={row.kind} className="w-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1"><span className="block truncate">{row.title}</span>{row.snippet && <span className="block truncate text-ui-sm text-fg-muted">{row.snippet}</span>}</span>
      <span className="ml-auto shrink-0 text-ui-sm text-fg-faint">{formatAge(now - row.lastEditedAt)}</span>
    </Command.Item>
  );
}

// U6b-5a M4 (decision 18; Interfaces §E): Recent's rows while `on`, from the window's opened list; each artifact's row is
// asked of its machine once per opening of the palette, and drawn once its answer names a row.
function useRecent(on: boolean): RecentRow[] {
  const opened = useVisits((s) => s.opened);
  const records = useSessions((s) => s.records);
  const digests = useSessions((s) => s.digests);
  const listed = useSessions((s) => s.listed);
  const turnsSeen = useSessions((s) => s.turnsSeen);
  const [answered, setAnswered] = useState<ReadonlyMap<string, LibraryRow | null>>(() => new Map());
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  const activity = (record: SessionRecord) => lastActivity(record, digests.get(record.appId), selectSeenAt({ listed, turnsSeen }, record.appId));
  const { rows, ask } = on ? recentRows({ opened, records, activity, answered }) : { rows: [], ask: [] };
  const askKey = ask.map(({ machine, artifactId }) => artifactKey(machine, artifactId)).join('\n');
  useEffect(() => {
    live.current = true;
    return () => void (live.current = false);
  }, []);
  useEffect(() => {
    for (const key of askKey === '' ? [] : askKey.split('\n')) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      const slash = key.indexOf('/'); // a machine's ref holds no '/'
      const machine = key.slice(0, slash) as MachineRef;
      void ipc.invoke('library.get', { artifactId: key.slice(slash + 1) }, { machine }).then(
        (answer) => (answer.ok ? answer.value.row : null),
        () => null,
      ).then((row) => {
        if (live.current) setAnswered((before) => new Map(before).set(key, row));
      });
    }
  }, [askKey]);
  return rows;
}
