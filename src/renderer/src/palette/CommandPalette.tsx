// The ⌘K palette (charter §5.8; C5 execution document, M5; residue *Command palette*): one searchable list of sessions,
// projects and every action of the table, in a Radix Dialog with cmdk for the combobox and its keyboard. Sessions are
// found with the sidebar search's own rule (title, project name, directory), so the two agree. ⏎ opens a session in
// the focused pane and ⌘⏎ in the split; a project is revealed in the sidebar; an action runs through `runAction`.
// Actions with no handler are listed greyed with what they wait for.
import { Command } from 'cmdk';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useState, type KeyboardEvent } from 'react';
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

export const usePalette = create<{ open: boolean }>()(() => ({ open: false }));
export const togglePalette = () => usePalette.setState((s) => ({ open: !s.open }));

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
    projects: [...input.projects.values()].filter((p) => q === '' || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q)),
    actions: ACTION_IDS.filter((id) => q === '' || ACTIONS[id].title.toLowerCase().includes(q)),
  };
}

// What an action without a handler waits for. The request and composer keys belong to the element holding focus
// (`useKeyChord`), so the palette, which holds focus itself, can never run them.
const UNAVAILABLE: Partial<Record<ActionId, string>> = {
  'session.new': 'Arrives with C10',
  'request.accept': 'Keyboard only, in a focused request',
  'request.decline': 'Keyboard only, in a focused request',
  'composer.send': 'Keyboard only, in the composer',
  'composer.cycleMode': 'Keyboard only, in the composer',
};

const ITEM =
  'flex h-(--row-h) cursor-default items-center gap-2 rounded-sm px-2 text-ui data-[disabled=true]:text-fg-faint data-[selected=true]:bg-bg-hover';
const GROUP = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-ui-sm [&_[cmdk-group-heading]]:text-fg-muted';

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => usePalette.setState({ open: next })}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[16%] left-1/2 z-50 w-[min(560px,90vw)] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-bg-overlay text-fg"
        >
          <VisuallyHidden.Root asChild>
            <Dialog.Title>Command palette</Dialog.Title>
          </VisuallyHidden.Root>
          <Palette />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Palette() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
  const entries = paletteEntries(query, { records, projects });
  const close = () => usePalette.setState({ open: false });

  const openSession = (appSessionId: AppSessionId, split: boolean) => {
    close();
    useLayout.getState().openSession(appSessionId, { split });
  };
  const reveal = (projectId: ProjectId) => {
    close();
    revealProject(projectId);
  };
  const run = (id: ActionId) => {
    close();
    runAction(id, id === 'tab.select' ? 1 : null);
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
        placeholder="Search sessions, projects and actions"
        className="h-11 w-full border-b border-border bg-transparent px-3 text-ui text-fg outline-none placeholder:text-fg-faint"
      />
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
        <Command.Empty className="p-3 text-ui-sm text-fg-muted">Nothing matches</Command.Empty>
        {entries.sessions.length > 0 && (
          <Command.Group heading="Sessions" className={GROUP}>
            {entries.sessions.map((record) => (
              <SessionItem key={record.appId} record={record} project={record.projectId ? (projects.get(record.projectId) ?? null) : null} onOpen={openSession} />
            ))}
          </Command.Group>
        )}
        {entries.projects.length > 0 && (
          <Command.Group heading="Projects" className={GROUP}>
            {entries.projects.map((project) => (
              <Command.Item key={project.id} value={`project:${project.id}`} onSelect={() => reveal(project.id)} className={ITEM}>
                <span className="truncate">{project.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {entries.actions.length > 0 && (
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

function SessionItem({ record, project, onOpen }: { record: SessionRecord; project: ProjectRecord | null; onOpen(id: AppSessionId, split: boolean): void }) {
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, record.appId));
  return (
    <Command.Item value={`session:${record.appId}`} onSelect={() => onOpen(record.appId, false)} className={ITEM}>
      <GlyphMark glyph={glyphFor(record, digest, pending)} className="w-4 shrink-0" />
      <span className="truncate">{record.title.text}</span>
      {project && <span className="ml-auto shrink-0 text-ui-sm text-fg-muted">{project.name}</span>}
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
