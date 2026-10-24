// The ⌘K palette (charter §5.8; C5 execution document, M5; residue *Command palette*): one searchable list of sessions,
// projects and every action of the table, in a Radix Dialog with cmdk for the combobox and its keyboard. Sessions are
// found with the sidebar search's own rule (title, project name, directory), so the two agree. ⏎ opens a session in
// the focused pane and ⌘⏎ in the split; a project is revealed in the sidebar; an action runs through `runAction`.
// Actions with no handler are listed greyed with what they wait for.
import { useDialogFocus } from '../app/dialog-focus';
import { Command } from 'cmdk';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import { ACTION_IDS, ACTIONS, effectiveChord, type ActionId } from '@shared/keymap/actions';
import { formatChord } from '@shared/keymap/chord';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { runAction, useActionEnabled } from '../keymap/actions-runtime';
import { sessionMatcher } from '../sidebar/derive';
import { revealProject } from '../sidebar/reveal';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { ipc } from '../ipc/client';
import { useNow } from '../app/use-now';
import { sessionAge } from '../sidebar/derive';
import type { CommandOutput } from '@shared/ipc/schema';
import { displayTitle } from '../sessions/title';
import { conversationSnippet } from './snippet';

export const usePalette = create<{ open: boolean; scope: 'all' | 'sessions'; query: string }>()(() => ({ open: false, scope: 'all', query: '' }));
export const openPalette = (query = '') => usePalette.setState({ open: true, scope: 'all', query });
export const togglePalette = () => {
  // Menu accelerators arrive outside React's key handler. A focused sidebar field carries its query into ⌘K too.
  const field = document.activeElement;
  const query = field instanceof HTMLInputElement && field.hasAttribute('data-palette-query') ? field.value : '';
  usePalette.setState((state) => ({ open: !state.open, scope: 'all', query }));
};
export const openConversationSearch = (query = '') => usePalette.setState({ open: true, scope: 'sessions', query });

export interface PaletteEntries {
  sessions: SessionRecord[];
  projects: ProjectRecord[];
  actions: ActionId[];
}

export function paletteEntries(
  query: string,
  input: { records: ReadonlyMap<AppSessionId, SessionRecord>; projects: ReadonlyMap<ProjectId, ProjectRecord> },
): PaletteEntries {
  const q = query.trim().toLowerCase();
  const matches = sessionMatcher(query, input.projects);
  return {
    sessions: [...input.records.values()].filter((r) => !r.archived && matches(r)),
    projects: [...input.projects.values()].filter((p) => !p.hidden && (q === '' || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q))), // W11: a hidden project is not revealed
    actions: ACTION_IDS.filter((id) => q === '' || ACTIONS[id].title.toLowerCase().includes(q)),
  };
}

// What an action without a handler waits for. The request and composer keys belong to the element holding focus
// (`useKeyChord`), so the palette, which holds focus itself, can never run them.
const UNAVAILABLE: Partial<Record<ActionId, string>> = {
  'session.new': 'Not available here',
  'request.accept': 'Keyboard only, in a focused request',
  'request.decline': 'Keyboard only, in a focused request',
  'composer.send': 'Keyboard only, in the composer',
  'composer.cycleMode': 'Keyboard only, in the composer',
};

// Bound item registration and subscriptions; filtering still searches the complete index.
const RESULT_LIMIT = 50;

const ITEM =
  'flex h-(--row-h) cursor-default items-center gap-2 rounded-sm px-2 text-ui data-[disabled=true]:text-fg-faint data-[selected=true]:bg-bg-hover';
const GROUP = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-ui-sm [&_[cmdk-group-heading]]:text-fg-muted';

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const focus = useDialogFocus();
  const pendingFocus = useRef<ActionId | null>(null);
  const run = (id: ActionId) => {
    // These actions rightly refuse keys from an active modal. A palette selection is an explicit destination: wait
    // for Radix to release the dialog and restore its opener, then navigate from that real shell focus stop.
    const afterClose = id === 'sidebar.focus' || id === 'region.focusNext' || id === 'region.focusPrevious';
    pendingFocus.current = afterClose ? id : null;
    usePalette.setState({ open: false });
    if (!afterClose) runAction(id, id === 'tab.select' ? 1 : null);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => usePalette.setState({ open: next })}>
      <Dialog.Portal>
        <Dialog.Content
          {...focus}
          onCloseAutoFocus={(event) => {
            focus.onCloseAutoFocus(event);
            const id = pendingFocus.current;
            pendingFocus.current = null;
            if (id !== null) runAction(id);
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
  const [content, setContent] = useState<{ query: string; hits: CommandOutput<'session.search'>['hits']; indexing?: boolean; incomplete?: boolean; error?: string } | null>(null);
  useEffect(() => {
    if (scope !== 'sessions') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const search = () => {
      void ipc.invoke('session.search', { query }).then((result) => {
        if (cancelled) return;
        setContent(result.ok ? { query, ...result.value } : { query, hits: [], error: result.error.message });
        if (result.ok && result.value.indexing) timer = setTimeout(search, 1000);
      }).catch((error: unknown) => { if (!cancelled) setContent({ query, hits: [], error: String(error) }); });
    };
    timer = setTimeout(search, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope]);
  const [selected, setSelected] = useState('');
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
  const entries = paletteEntries(query, { records, projects });
  const searching = scope === 'sessions' && content?.query !== query;
  const hits = scope === 'sessions' && !searching ? content?.hits ?? [] : [];
  const sessions = scope === 'all' ? entries.sessions : hits.flatMap((hit) => { const record = records.get(hit.appSessionId); return record && !record.archived ? [record] : []; });
  const close = () => usePalette.setState({ open: false });

  const openSession = (appSessionId: AppSessionId, split: boolean) => {
    close();
    useLayout.getState().openSession(appSessionId, { split });
  };
  const reveal = (projectId: ProjectId) => {
    close();
    revealProject(projectId);
  };
  // ⌘⏎ on a session opens it in the split; cmdk leaves a key whose default is already taken.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !event.metaKey || !selected.startsWith('session:')) return;
    event.preventDefault();
    openSession(selected.slice('session:'.length) as AppSessionId, true);
  };

  return (
    <Command label="Command palette" shouldFilter={false} value={selected} onValueChange={setSelected} onKeyDown={onKeyDown} loop>
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
      {scope === 'sessions' && content?.query === query && content.indexing && <p role="status" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Indexing conversations… Results will update.</p>}
      {scope === 'sessions' && content?.query === query && content.incomplete && <p role="alert" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Some conversations could not be indexed. Results may be incomplete. Indexing will retry after a restart or when those conversations change.</p>}
      {searching && <p role="status" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Searching conversations…</p>}
      {scope === 'sessions' && content?.query === query && content.error && <p role="alert" className="m-0 px-3 py-2 text-ui-sm text-fg-muted">{content.error}</p>}
      {(scope === 'sessions' ? sessions.length >= RESULT_LIMIT : entries.sessions.length > RESULT_LIMIT || entries.projects.length > RESULT_LIMIT) && (
        <p className="m-0 px-3 py-2 text-ui-sm text-fg-muted">Showing the first {RESULT_LIMIT} matches per group. Type to narrow results.</p>
      )}
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
        <Command.Empty className="p-3 text-ui-sm text-fg-muted">Nothing matches</Command.Empty>
        {sessions.length > 0 && (
          <Command.Group heading="Sessions" className={GROUP}>
            {sessions.slice(0, RESULT_LIMIT).map((record) => (
              <SessionItem key={record.appId} record={record} snippet={hits.find((hit) => hit.appSessionId === record.appId)?.snippet} project={record.projectId ? (projects.get(record.projectId) ?? null) : null} onOpen={openSession} />
            ))}
          </Command.Group>
        )}
        {scope === 'all' && entries.projects.length > 0 && (
          <Command.Group heading="Projects" className={GROUP}>
            {entries.projects.slice(0, RESULT_LIMIT).map((project) => (
              <Command.Item key={project.id} value={`project:${project.id}`} onSelect={() => reveal(project.id)} className={ITEM}>
                <span className="truncate">{project.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {scope === 'all' && entries.actions.length > 0 && (
          <Command.Group heading="Actions" className={GROUP}>
            {entries.actions.map((id) => (
              <ActionItem key={id} id={id} onRun={run} />
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command>
  );
}

function SessionItem({ record, project, snippet, onOpen }: { snippet?: string | null; record: SessionRecord; project: ProjectRecord | null; onOpen(id: AppSessionId, split: boolean): void }) {
  const now = useNow();
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, record.appId));
  return (
    <Command.Item value={`session:${record.appId}`} onSelect={() => onOpen(record.appId, false)} className={`${ITEM} ${snippet ? "h-auto min-h-(--row-h) py-1.5" : ""}`}>
      <GlyphMark glyph={glyphFor(record, digest, pending)} className="w-4 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate">{displayTitle(record)}</span>{snippet && <span className="line-clamp-2 block text-ui-sm text-fg-muted">{conversationSnippet(snippet)}</span>}</span>
      {project && <span className="ml-auto max-w-[30%] shrink-0 truncate text-ui-sm text-fg-muted">{project.name}</span>}
      <span className="shrink-0 text-ui-sm text-fg-faint">{sessionAge(record, digest ?? undefined, now)}</span>
    </Command.Item>
  );
}

function ActionItem({ id, onRun }: { id: ActionId; onRun(id: ActionId): void }) {
  const enabled = useActionEnabled(id);
  const overrides = useSettings((s) => s.state?.settings.keymap);
  const chord = effectiveChord(id, overrides ?? {});
  return (
    <Command.Item value={`action:${id}`} disabled={!enabled} onSelect={() => onRun(id)} className={ITEM}>
      <span className="truncate">{ACTIONS[id].title}</span>
      {!enabled && <span className="text-ui-sm">{UNAVAILABLE[id] ?? 'Unavailable'}</span>}
      {chord && <kbd className="ml-auto shrink-0 font-ui text-ui-sm text-fg-muted">{formatChord(chord)}</kbd>}
    </Command.Item>
  );
}
