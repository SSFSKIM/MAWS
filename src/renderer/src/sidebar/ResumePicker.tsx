// The Resume… picker (§5.1 as amended 2026-10-01, W11, I7, as the owner corrected it): opened from the search button on
// a project row and from its context menu, a floating dialog in W3's widget style (`composer/WidgetDialog.tsx`: centred,
// the dimmed window behind) holding the palette's searchable list (cmdk). It copies `claude --resume`: "Resume session",
// a search field, rows of the title over "age · branch", scoped to the project, with the CLI's toggles: All projects
// (⌃A), Current branch (⌃B), All worktrees (⌃W). Enter opens the session (`openSession`), ⌘Enter in a new tab
// (`openTab`), Esc closes. The CLI's third fact, the transcript's size, is left out: the index keeps it but neither the
// record nor the digest carries it, and a stat per row is not worth it. Rows show the hundred newest matches; the
// search narrows the rest.
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useNow } from '../app/use-now';
import { lastActivity } from '../overview/derive';
import { ipc } from '../ipc/client';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { formatAge } from './derive';
import { NO_TOGGLES, resumeCandidates, sessionBranch, TOGGLE_KEYS, type ResumeToggles } from './resume';

export const useResumePicker = create<{ projectId: ProjectId | null }>()(() => ({ projectId: null }));
export const openResumePicker = (projectId: ProjectId) => useResumePicker.setState({ projectId });
const closeResumePicker = () => useResumePicker.setState({ projectId: null });

const SHOWN = 100;

export function ResumePickerHost() {
  const projectId = useResumePicker((s) => s.projectId);
  if (projectId === null) return null;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && closeResumePicker()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg opacity-60" />
        <Dialog.Content
          aria-describedby={undefined}
          data-resume-picker
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(560px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-strong bg-bg-overlay p-3 text-ui text-fg shadow-composer outline-none"
        >
          <Picker key={projectId} projectId={projectId} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// The branch the project's own checkout has out, as git lists it; null until it answers, and for a folder git does not
// know (Current branch then keeps nothing).
function useCurrentBranch(directory: string | null): string | null {
  const [answer, setAnswer] = useState<{ directory: string; branch: string | null } | null>(null);
  useEffect(() => {
    if (directory === null) return;
    let live = true;
    void ipc.invoke('git.worktree.list', { repoRoot: directory }).then(
      (result) => live && setAnswer({ directory, branch: result.ok ? (result.value.worktrees.find((w) => w.isMain)?.branch ?? null) : null }),
      () => live && setAnswer({ directory, branch: null }),
    );
    return () => {
      live = false;
    };
  }, [directory]);
  return answer?.directory === directory ? answer.branch : null;
}

const TOGGLES: { key: keyof ResumeToggles; label: string; chord: string }[] = [
  { key: 'allProjects', label: 'All projects', chord: '⌃A' },
  { key: 'currentBranch', label: 'Current branch', chord: '⌃B' },
  { key: 'allWorktrees', label: 'All worktrees', chord: '⌃W' },
];

const ITEM = 'flex cursor-default flex-col gap-0.5 rounded-sm px-2 py-1.5 data-[selected=true]:bg-bg-hover';

function Picker({ projectId }: { projectId: ProjectId }) {
  const records = useSessions((s) => s.records);
  const digests = useSessions((s) => s.digests);
  const projects = useSessions((s) => s.projects);
  const project = projects.get(projectId) ?? null;
  const branch = useCurrentBranch(project?.directory ?? null);
  const [query, setQuery] = useState('');
  const [toggles, setToggles] = useState<ResumeToggles>(NO_TOGGLES);
  const [selected, setSelected] = useState('');
  const now = useNow();

  const found = useMemo(() => resumeCandidates({ records, digests, projects, projectId, toggles, branch, query }), [records, digests, projects, projectId, toggles, branch, query]);
  const rows = found.slice(0, SHOWN);

  const open = (appSessionId: AppSessionId, newTab: boolean) => {
    closeResumePicker();
    if (newTab) useLayout.getState().openTab({ kind: 'session', appSessionId });
    else useLayout.getState().openSession(appSessionId);
  };
  const flip = (key: keyof ResumeToggles) => setToggles((t) => ({ ...t, [key]: !t[key] }));

  const onKeyDown = (event: KeyboardEvent) => {
    const toggle = event.ctrlKey && !event.metaKey && !event.altKey ? TOGGLE_KEYS[event.key.toLowerCase()] : undefined;
    if (toggle) {
      event.preventDefault();
      flip(toggle);
      return;
    }
    // ⌘⏎ opens in a new tab; cmdk leaves a key whose default is already taken.
    if (event.key === 'Enter' && event.metaKey && selected.startsWith('session:')) {
      event.preventDefault();
      open(selected.slice('session:'.length) as AppSessionId, true);
    }
  };

  const meta = (record: SessionRecord) => {
    const age = formatAge(now - lastActivity(record, digests.get(record.appId)));
    const owner = toggles.allProjects ? (record.projectId === null ? 'Other sessions' : (projects.get(record.projectId)?.name ?? null)) : null;
    return [age === 'now' ? 'now' : `${age} ago`, sessionBranch(record), owner].filter(Boolean).join(' · ');
  };

  return (
    <Command label="Resume session" shouldFilter={false} value={selected} onValueChange={setSelected} onKeyDown={onKeyDown} loop className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <Dialog.Title className="m-0 text-ui font-medium text-fg">Resume session</Dialog.Title>
        <span data-testid="resume-scope" className="min-w-0 truncate text-ui-sm text-fg-muted">
          {toggles.allProjects ? 'All projects' : (project?.name ?? '')}
        </span>
      </div>
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Search sessions"
        className="h-9 w-full rounded-sm border border-border bg-transparent px-2.5 text-ui text-fg outline-none placeholder:text-fg-faint focus:border-accent"
      />
      <div role="group" aria-label="Filters" className="mt-2 flex flex-wrap gap-1.5">
        {TOGGLES.map(({ key, label, chord }) => (
          <button
            key={key}
            type="button"
            aria-pressed={toggles[key]}
            onClick={() => flip(key)}
            className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:border-accent aria-pressed:text-fg"
          >
            {label}
            <kbd className="font-ui text-fg-faint">{chord}</kbd>
          </button>
        ))}
      </div>
      <Command.List className="mt-2 max-h-[min(420px,55vh)] min-h-0 overflow-y-auto">
        <Command.Empty className="p-3 text-ui-sm text-fg-muted">{query.trim() === '' ? 'No sessions' : 'No sessions match'}</Command.Empty>
        {rows.map((record) => (
          <Command.Item key={record.appId} value={`session:${record.appId}`} onSelect={() => open(record.appId, false)} className={ITEM}>
            <span className="truncate text-ui text-fg">{displayTitle(record)}</span>
            <span className="truncate text-ui-sm text-fg-muted tabular-nums">{meta(record)}</span>
          </Command.Item>
        ))}
      </Command.List>
      {found.length > rows.length && (
        <p className="m-0 mt-1 px-2 text-ui-sm text-fg-faint">
          The {SHOWN} newest of {found.length}; type to narrow
        </p>
      )}
      <p className="m-0 mt-2 border-t border-border px-1 pt-2 text-ui-sm text-fg-faint">⏎ to open · ⌘⏎ in a new tab · esc to close</p>
    </Command>
  );
}
