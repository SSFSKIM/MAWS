// The resume chooser (the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G1 to G5; owner
// decision 5): one component for `/resume` and the sidebar's Resume…, built to Claude Desktop 2.16120.0's picker
// (readable/app-2.16120.0/web/app/v1/cc43287c9-ua-2O55p.js:34300-35069). On the left the search (title, folder, branch),
// the scope toggles and the sessions grouped by when they were last active, each row its title, branch, folder badge and
// time; on the right the selected session's preview: its cached title, folder, branch, last activity and last answer at
// once, then the recent turns read lazily for the settled selection (`preview.ts`). A click or the arrows select and
// preview; Enter or a double click opens the session in the current tab (F2b 2.5's `openSession`), ⌘Enter in a new tab.
// Nothing here launches an engine or marks anything read: opening shows the transcript, and the first Send continues the
// session (P2-A's acquisition once it lands). The host gives the box (X19's library size) and Esc.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { RecentTurn } from '@shared/ipc/schema/session';
import { formatDateTime } from '../app/date-format';
import { relativeAge } from '../app/relative-age';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { ipc } from '../ipc/client';
import { availabilityRefusal, useAvailability } from '../sessions/availability'; // P2-A's X16, read only
import { displayTitle } from '../sessions/title';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { RESUME_COPY as COPY } from './copy';
import {
  chooserGroups,
  chooserRows,
  folderBadge,
  initialToggles,
  rowTime,
  sessionBranch,
  shortBranch,
  TOGGLE_KEYS,
  type ChooserContext,
  type ChooserRow,
  type ChooserToggles,
  type GroupKind,
} from './model';
import { useRecentTurns } from './preview';

// Rows drawn at first, and how many more a scroll near the list's end (within NEAR_END px) or an ArrowDown past the last
// row adds; a new search or scope starts at the first page again (Desktop's picker, cc43287c9-ua-2O55p.js:34271-34273,
// 34393-34399, 34487-34495, 34519-34525, 34655, 34672; P2-F L131).
export const SHOWN = 100;
const MORE = 100;
const NEAR_END = 320;
const PROMPT_SHOWN = 400; // Desktop's caps on a preview's user and assistant text
const ANSWER_SHOWN = 700;

export interface ResumeChooserProps {
  context: ChooserContext;
  close(reason?: 'opened'): void; // 'opened': the close opened a session, whose tab takes the keyboard
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

const TOGGLES: { key: keyof ChooserToggles; chord: string | null }[] = [
  { key: 'allProjects', chord: '⌃A' },
  { key: 'currentBranch', chord: '⌃B' },
  { key: 'allWorktrees', chord: '⌃W' },
  { key: 'archived', chord: null },
];

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const isTextField = (el: EventTarget | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

export function ResumeChooser({ context, close }: ResumeChooserProps) {
  const records = useSessions((s) => s.records);
  const digests = useSessions((s) => s.digests);
  const projects = useSessions((s) => s.projects);
  const project = context.projectId === null ? null : (projects.get(context.projectId) ?? null);
  const branch = useCurrentBranch(project?.directory ?? null);
  const [query, setQuery] = useState('');
  const [toggles, setToggles] = useState<ChooserToggles>(() => initialToggles(context));
  const [picked, setPicked] = useState<AppSessionId | null>(null);
  const [settled, setSettled] = useState(false); // false until the selection first moves (a fallback too): the opening one previews at once
  const [limit, setLimit] = useState(SHOWN);
  const now = useNow();
  const search = useRef<HTMLInputElement>(null);
  const ids = useId();

  const rows = useMemo(() => chooserRows({ records, digests, projects, context, toggles, branch, query }), [records, digests, projects, context, toggles, branch, query]);
  const shown = rows.slice(0, limit);
  const groups = chooserGroups(shown, now);
  // The selection stays on its session while the stores change; one that left the list falls back to the first row. The
  // row shown selected is the one kept: the opening one, a search's first row and a fallback are committed as they show,
  // so a row that becomes the newest, or the one that left coming back, takes nothing.
  const selected = shown.find((row) => row.record.appId === picked) ?? shown[0] ?? null;
  const selectedId = selected?.record.appId ?? null;
  if (selectedId !== picked) {
    setPicked(selectedId);
    // only the opening selection previews at once; a fallback replacing a kept one settles like a move
    if (picked !== null) setSettled(true);
  }
  const optionId = (appSessionId: AppSessionId) => `${ids}-${appSessionId}`;

  useEffect(() => {
    if (selectedId === null) return;
    document.getElementById(optionId(selectedId))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the id prefix is stable
  }, [selectedId]);

  const select = (appSessionId: AppSessionId) => {
    setPicked(appSessionId);
    setSettled(true);
  };
  const open = (appSessionId: AppSessionId, newTab: boolean) => {
    close('opened');
    if (newTab) useLayout.getState().openTab({ kind: 'session', appSessionId });
    else useLayout.getState().openSession(appSessionId);
  };
  const flip = (key: keyof ChooserToggles) => {
    setToggles((t) => ({ ...t, [key]: !t[key] }));
    setLimit(SHOWN);
    setSettled(true);
  };
  // the next page, if any rows are left undrawn; the first of them
  const loadMore = (): ChooserRow | null => {
    const next = rows[shown.length] ?? null;
    if (next !== null) setLimit(shown.length + MORE);
    return next;
  };
  const move = (by: number) => {
    if (shown.length === 0) return;
    const at = selected === null ? -1 : shown.indexOf(selected);
    const next = at + by >= shown.length ? (loadMore() ?? shown[shown.length - 1]) : shown[Math.max(0, at + by)];
    select(next.record.appId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return; // an IME's Enter and arrows are its own
    const toggle = event.ctrlKey && !event.metaKey && !event.altKey ? TOGGLE_KEYS[event.key.toLowerCase()] : undefined;
    if (toggle) {
      event.preventDefault();
      flip(toggle);
      return;
    }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plain && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      // a button's Enter is its own press (a scope toggle, Close)
      if (event.target instanceof HTMLButtonElement || event.repeat || selectedId === null) return;
      event.preventDefault();
      open(selectedId, event.metaKey);
      return;
    }
    // type to search: a printable key typed elsewhere in the chooser lands in the search field
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !isTextField(event.target) && event.key !== ' ') search.current?.focus();
  };

  const scopeLabel = toggles.allProjects ? COPY.allProjects : context.projectId === null ? COPY.otherSessions : (project?.name ?? '');
  const listId = `${ids}-list`;

  return (
    <div data-resume-chooser className="flex min-h-0 min-w-0 flex-1 flex-col text-ui" onKeyDown={onKeyDown}>
      <header className="flex items-center gap-2 px-1 pb-2">
        <h2 className="m-0 shrink-0 text-ui font-semibold text-fg">{COPY.title}</h2>
        <span data-testid="resume-scope" className="min-w-0 truncate text-ui-sm text-fg-muted">
          {scopeLabel}
        </span>
        <button type="button" aria-label={COPY.close} onClick={() => close()} className="ml-auto rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
          ×
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col sm:w-[min(26rem,45%)] sm:flex-none">
          <input
            ref={search}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={selectedId === null ? undefined : optionId(selectedId)}
            aria-label={COPY.search}
            placeholder={COPY.search}
            autoComplete="off"
            spellCheck={false}
            data-escape-clears
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(SHOWN);
              setPicked(null); // a new search selects its first row
              setSettled(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
                setLimit(SHOWN);
              }
            }}
            className="h-9 w-full shrink-0 rounded-sm border border-border bg-transparent px-2.5 text-ui text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
          <div role="group" aria-label={COPY.filters} className="mt-2 flex shrink-0 flex-wrap gap-1.5">
            {TOGGLES.map(({ key, chord }) => (
              <button
                key={key}
                type="button"
                aria-pressed={toggles[key]}
                onClick={() => flip(key)}
                className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:border-accent aria-pressed:text-fg"
              >
                {COPY.toggles[key]}
                {chord && <kbd className="font-ui text-fg-faint">{chord}</kbd>}
              </button>
            ))}
          </div>
          {/* the list keeps the keyboard in the search field: a press selects without taking focus */}
          <div
            id={listId}
            role="listbox"
            aria-label={COPY.list}
            className="mt-2 min-h-0 flex-1 overflow-y-auto"
            onMouseDown={(event) => event.preventDefault()}
            onScroll={(event) => {
              const list = event.currentTarget;
              if (list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_END) loadMore();
            }}
          >
            {shown.length === 0 && <p className="m-0 p-3 text-ui-sm text-fg-muted">{query.trim() === '' ? COPY.none : COPY.noMatch}</p>}
            {groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.label}>
                <div aria-hidden className="px-2 pt-2 pb-1 text-ui-sm text-fg-faint">
                  {group.label}
                </div>
                {group.rows.map((row) => (
                  <Row
                    key={row.record.appId}
                    id={optionId(row.record.appId)}
                    row={row}
                    kind={group.kind}
                    now={now}
                    selected={row === selected}
                    badge={folderBadge(row.record, projects, toggles.allProjects ? null : context.projectId)}
                    onSelect={() => select(row.record.appId)}
                    onOpen={() => open(row.record.appId, false)}
                  />
                ))}
              </div>
            ))}
            {rows.length > shown.length && <p className="m-0 mt-1 px-2 text-ui-sm text-fg-faint">{COPY.more(shown.length, rows.length)}</p>}
          </div>
        </div>
        <Preview row={selected} projects={projects} now={now} immediate={!settled} />
      </div>
      <div data-legend aria-hidden className="mt-2 flex shrink-0 items-center gap-3 border-t border-border px-1 pt-2 text-ui-sm text-fg-faint">
        <span>
          <kbd className="font-ui">↑↓</kbd> {COPY.legend.move}
        </span>
        <span className="ml-auto">
          <kbd className="font-ui">⏎</kbd> {COPY.legend.open}
        </span>
        <span>
          <kbd className="font-ui">⌘⏎</kbd> {COPY.legend.newTab}
        </span>
        <span>
          <kbd className="font-ui">esc</kbd> {COPY.legend.close}
        </span>
      </div>
    </div>
  );
}

// P2-A (X16, availability, read only): why the owner cannot continue a session from here, for the two states the chooser
// lists that no gesture continues (an archive, a terminal or job holding it), in A's words; null otherwise. Opening one
// still shows its transcript.
function useRefusal(record: SessionRecord): string | null {
  const availability = useAvailability(record.appId);
  return availability === 'archived' || availability === 'foreign_held' ? availabilityRefusal(availability, record.holder) : null;
}

function Row({ id, row, kind, now, selected, badge, onSelect, onOpen }: { id: string; row: ChooserRow; kind: GroupKind; now: number; selected: boolean; badge: string | null; onSelect(): void; onOpen(): void }) {
  const { record } = row;
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, record.appId));
  const glyph = glyphFor(record, digest, pending);
  const refusal = useRefusal(record);
  const branch = sessionBranch(record);
  const title = displayTitle(record);
  return (
    <div
      id={id}
      title={refusal ?? undefined}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className="flex h-8 cursor-default items-center gap-1.5 rounded-sm px-2 text-fg-muted hover:bg-bg-hover data-[selected=true]:bg-bg-active data-[selected=true]:text-fg"
    >
      <GlyphMark glyph={glyph} className="w-3 shrink-0 text-ui-sm" />
      <span data-title className="min-w-8 shrink truncate">
        {title}
      </span>
      {record.archived && <span className="shrink-0 rounded-sm border border-border px-1 text-ui-sm text-fg-faint">{COPY.archived}</span>}
      {branch && (
        <span data-testid="row-branch" title={branch} className="max-w-[9rem] min-w-9 shrink-[100] truncate text-ui-sm text-fg-faint">
          ⎇ {shortBranch(branch)}
        </span>
      )}
      {badge && (
        <span data-testid="row-folder" title={record.worktree?.path ?? record.directory} className="max-w-[7rem] shrink-0 truncate rounded-sm border border-border px-1 text-ui-sm text-fg-muted">
          {badge}
        </span>
      )}
      <span title={formatDateTime(row.at)} className="ml-auto min-w-14 shrink-0 text-right text-ui-sm text-fg-faint tabular-nums">
        {rowTime(row.at, kind, now)}
      </span>
    </div>
  );
}

function Fact({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <>
      <dt className="text-fg-faint">{label}</dt>
      <dd className="m-0 min-w-0 truncate text-fg" title={title}>
        {children}
      </dd>
    </>
  );
}

const PREVIEW_FRAME = 'flex min-h-0 min-w-0 flex-1 flex-col border-t border-border pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4';

type PreviewProps = { row: ChooserRow; projects: ReadonlyMap<ProjectId, ProjectRecord>; now: number; immediate: boolean };

// The preview pane: nothing to preview without a selection, else the selected session's (which owns the subscriptions).
function Preview({ row, ...rest }: Omit<PreviewProps, 'row'> & { row: ChooserRow | null }) {
  if (row === null) {
    return (
      <section aria-label="Preview" className={PREVIEW_FRAME}>
        <p className="m-0 text-ui-sm text-fg-muted">{COPY.nothing}</p>
      </section>
    );
  }
  return <SessionPreview row={row} {...rest} />;
}

function SessionPreview({ row, projects, now, immediate }: PreviewProps) {
  const { record } = row;
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, record.appId));
  const preview = useRecentTurns(record.appId, immediate);
  const turns = useRef<HTMLDivElement>(null);
  const ready = preview.status === 'ready' ? preview.value : null;
  // the latest turn in view, as a transcript opens
  useEffect(() => {
    if (ready && turns.current) turns.current.scrollTop = turns.current.scrollHeight;
  }, [ready]);
  const glyph = glyphFor(record, digest, pending);
  const refusal = useRefusal(record);
  const branch = sessionBranch(record);
  const projectName = record.projectId === null ? COPY.otherSessions : (projects.get(record.projectId)?.name ?? null);
  const title = displayTitle(record);
  return (
    <section aria-label="Preview" data-testid="resume-preview" className={PREVIEW_FRAME}>
      <h3 className="m-0 flex min-w-0 items-center gap-1.5 text-ui font-semibold text-fg">
        <GlyphMark glyph={glyph} className="w-3 shrink-0 text-ui-sm font-normal" />
        <span className="truncate">{title}</span>
      </h3>
      <dl className="m-0 mt-2 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-sm">
        <Fact label={COPY.facts.folder} title={record.directory}>
          {record.directory}
        </Fact>
        {branch && <Fact label={COPY.facts.branch}>⎇ {branch}</Fact>}
        {projectName && <Fact label={COPY.facts.project}>{projectName}</Fact>}
        <Fact label={COPY.facts.lastActive} title={formatDateTime(row.at)}>
          {capitalised(relativeAge(Math.max(0, now - row.at)))}
        </Fact>
        {digest?.lastAssistantLine && (
          <Fact label={COPY.facts.lastAnswer} title={digest.lastAssistantLine}>
            {digest.lastAssistantLine}
          </Fact>
        )}
      </dl>
      {refusal && (
        <p role="note" data-testid="resume-refusal" className="m-0 mt-2 shrink-0 text-ui-sm text-fg-muted">
          {refusal}
        </p>
      )}
      <h4 className="m-0 mt-3 shrink-0 text-ui-sm font-medium text-fg-muted">{COPY.where}</h4>
      <div ref={turns} data-testid="resume-turns" aria-busy={preview.status === 'loading'} tabIndex={0} className="mt-1 min-h-0 flex-1 overflow-y-auto pr-1 outline-accent focus-visible:outline-2">
        {preview.status === 'loading' && <p className="m-0 text-ui-sm text-fg-faint">{COPY.loading}</p>}
        {preview.status === 'error' && <p className="m-0 text-ui-sm text-fg-muted">{COPY.failed}</p>}
        {/* no turn in the read window: an existing conversation whose turns lie before it, else one with none */}
        {ready && ready.turns.length === 0 && <p className="m-0 text-ui-sm text-fg-faint">{ready.earlier ? COPY.earlier : COPY.empty}</p>}
        {ready && ready.turns.length > 0 && (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {ready.earlier && <li className="text-center text-ui-sm text-fg-faint">{COPY.earlier}</li>}
            {ready.turns.map((turn, i) => (
              <Turn key={`${turn.prompt?.at ?? ''}:${turn.answer?.at ?? ''}:${i}`} turn={turn} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Turn({ turn }: { turn: RecentTurn }) {
  return (
    <li className="flex flex-col gap-1">
      {turn.prompt && <p className="m-0 ml-auto max-w-[75%] rounded-lg bg-bg-hover px-3 py-1.5 text-ui break-words whitespace-pre-wrap text-fg">{clip(turn.prompt.text, PROMPT_SHOWN)}</p>}
      {turn.toolCalls > 0 && <p className="m-0 text-ui-sm text-fg-faint">{COPY.toolCalls(turn.toolCalls)}</p>}
      {turn.answer && <p className="m-0 text-ui break-words whitespace-pre-wrap text-fg">{clip(turn.answer.text, ANSWER_SHOWN)}</p>}
    </li>
  );
}
