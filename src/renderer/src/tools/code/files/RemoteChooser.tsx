// The chooser's sheet for a session on another machine (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E "The chooser's layout"; Card 1 as the
// owner answered it; Decision Log 6). It draws the model of `remote-chooser.ts` and holds no state of the walk itself:
// - The sheet is U11's `Sheet` at the remote folder sheet's width (`RemoteSetupSheet.tsx`), so it takes the scrim,
//   Escape and the focus rules sheets have; Escape and the scrim cancel as Cancel does.
// - The list's area keeps one height in every state (that sheet's list at its tallest, capped by the window as that list
//   is): a listing scrolls inside it, and the reading words and each failure, with Try again, stand inside it. ".." is its
//   first row wherever a parent is known. More… is a quiet button under it, outside its scroll, its place kept with no
//   further page. A private folder's question alone replaces the field, the list and the footer, as that sheet's does.
// - A folder's mark is the Files list's chevron, closed; every other mark slot is empty and as wide. A row's title is
//   its whole name, cut at its end by the row's own truncation. A click enters a folder and selects a file or a link; a
//   double click chooses it.
// - The path field shows the folder shown (the home as `~`), scrolled to its end while it does not hold the keyboard.
// - C5: the link dropping while a folder is shown asks that folder again, so the list's place says what the machine
//   answers (or that it is not reachable) rather than standing as if nothing had happened.
// - Fix wave (review finding 2): the ownership going while the sheet is open withdraws the offer: its sentence stands in
//   the list's place, and the sheet sends nothing more.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { OutsideEntry } from '@shared/ipc/schema/files';
import { useRemoteStanding } from '../../../lane-b/remote-standing';
import { Sheet } from '../../../sessions/Sheet';
import { FIELD, PRIMARY, QUIET, SECONDARY } from '../../../sessions/ui';
import { REMOTE_CHOOSER_COPY } from '../copy';
import { ownersOnly } from './elsewhere';
import { Chevron } from './FilesTool';
import { parentOf, type ChooserState, type RemoteChooser as Model } from './remote-chooser';

type Listed = Extract<ChooserState, { at: 'listed' }>;

const ROW = 'flex h-7 w-full shrink-0 cursor-default items-center gap-2 rounded-sm px-2 text-left text-ui outline-accent hover:bg-bg-hover focus-visible:outline-2 aria-selected:bg-bg-active disabled:text-fg-faint disabled:hover:bg-transparent';
const LINE = 'px-2 py-1 text-ui-sm text-fg-muted';
const MARK = 'w-3 shrink-0'; // a mark slot as wide as the chevron
const TAG = 'ml-auto shrink-0 text-ui-sm text-fg-muted';
const WIDTH = 'w-[min(480px,90vw)]';

const tildified = (path: string, home: string | null): string =>
  home === null || home === '/' ? path : path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;

export function RemoteChooser({ appSessionId, chooser, onClose, onChosen }: { appSessionId: AppSessionId; chooser: Model; onClose(): void; onChosen(path: string): void }) {
  const state = useSyncExternalStore(chooser.subscribe, chooser.state);
  const standing = useRemoteStanding(appSessionId);
  const machine = standing?.machine ?? '';
  // What the list's area draws while a choice is asked: the listing it was asked from
  const [shown, setShown] = useState<Listed | null>(null);
  if (state.at === 'listed' && state !== shown) setShown(state);
  const home = shown?.home ?? null;

  // C5: a drop of the link under a listing asks the folder again
  const phase = standing?.phase ?? null;
  const lastPhase = useRef(phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = phase;
    if (was === 'up' && phase !== 'up' && chooser.state().at === 'listed') chooser.retry();
  }, [phase, chooser]);

  const ownership = ownersOnly(standing, 'files.chooseOutside');
  useEffect(() => {
    if (ownership !== null) chooser.withdraw(ownership);
  }, [ownership, chooser]);

  const close = () => {
    chooser.cancel();
    onClose();
  };
  const choose = () =>
    void chooser.choose().then((path) => {
      if (path !== null) onChosen(path);
    });

  if (state.at === 'asking')
    return (
      <Sheet title={REMOTE_CHOOSER_COPY.title(machine)} width={WIDTH} onClose={close} data-remote-chooser="">
        <div className="flex flex-col gap-3">
          <p className="m-0">{REMOTE_CHOOSER_COPY.openPrivate(state.folder.name, machine)}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={SECONDARY} onClick={() => chooser.back()}>
              {REMOTE_CHOOSER_COPY.back}
            </button>
            <button type="button" className={PRIMARY} onClick={() => chooser.confirm()}>
              {REMOTE_CHOOSER_COPY.open}
            </button>
          </div>
        </div>
      </Sheet>
    );

  const busy = state.at === 'choosing';
  const listing = state.at === 'listed' ? state : busy ? shown : null;
  const parent = busy ? (listing?.parent ?? null) : parentOf(state);
  const fieldPath = listing !== null ? listing.path : state.at === 'reading' || state.at === 'failed' ? state.path : null;
  const cursor = state.at === 'listed' ? state.cursor : null;

  return (
    <Sheet title={REMOTE_CHOOSER_COPY.title(machine)} width={WIDTH} onClose={close} data-remote-chooser="">
      <div className="flex flex-col gap-3">
        <PathField shown={fieldPath === null ? '~' : tildified(fieldPath, home)} disabled={busy} go={(path) => chooser.go(path)} />
        <div data-chooser-list="" className="flex h-[min(280px,40vh)] flex-col overflow-y-auto rounded-sm border border-border p-1">
          {parent !== null && (
            <button type="button" data-up="" className={ROW} disabled={busy} onClick={() => chooser.up()}>
              <span className={MARK} aria-hidden="true" />
              <span className="min-w-0 truncate">{REMOTE_CHOOSER_COPY.up}</span>
            </button>
          )}
          {state.at === 'reading' ? (
            <p className={`m-0 ${LINE}`}>{REMOTE_CHOOSER_COPY.reading}</p>
          ) : state.at === 'failed' ? (
            <div className="flex shrink-0 items-center gap-2 py-1 pr-1 pl-2">
              <span role="alert" className="min-w-0 flex-1 text-ui-sm text-fg-muted">
                {state.words}
              </span>
              <button type="button" className={SECONDARY} onClick={() => chooser.retry()}>
                {REMOTE_CHOOSER_COPY.retry}
              </button>
            </div>
          ) : listing !== null && listing.entries.length === 0 ? (
            <p className={`m-0 ${LINE}`}>{REMOTE_CHOOSER_COPY.empty}</p>
          ) : (
            listing?.entries.map((entry) => <EntryRow key={entry.path} entry={entry} selected={listing.selected === entry.path} disabled={busy} chooser={chooser} choose={choose} />)
          )}
        </div>
        <button
          type="button"
          data-chooser-more=""
          className={`${QUIET} self-start ${cursor === null ? 'invisible' : ''}`}
          disabled={cursor === null}
          onClick={() => chooser.more()}
        >
          {REMOTE_CHOOSER_COPY.more}
        </button>
        <p className="m-0 text-ui-sm text-fg-muted">{REMOTE_CHOOSER_COPY.foot(machine)}</p>
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={close}>
            {REMOTE_CHOOSER_COPY.cancel}
          </button>
          <button type="button" className={PRIMARY} disabled={busy || state.at !== 'listed' || state.selected === null} aria-busy={busy || undefined} onClick={choose}>
            {REMOTE_CHOOSER_COPY.open}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function EntryRow({ entry, selected, disabled, chooser, choose }: { entry: OutsideEntry; selected: boolean; disabled: boolean; chooser: Model; choose(): void }) {
  const selectable = entry.kind === 'file' || entry.kind === 'link';
  return (
    <button
      type="button"
      data-entry=""
      data-kind={entry.kind}
      title={entry.name}
      aria-selected={selected}
      className={ROW}
      disabled={disabled || entry.kind === 'other'}
      onClick={() => {
        if (entry.kind === 'dir') chooser.enter(entry);
        else if (selectable) chooser.select(entry.path);
      }}
      onDoubleClick={() => {
        if (!selectable) return;
        chooser.select(entry.path);
        choose();
      }}
    >
      {entry.kind === 'dir' ? <Chevron open={false} /> : <span className={MARK} aria-hidden="true" />}
      <span className="min-w-0 truncate">{entry.name}</span>
      {entry.protected && <span className={TAG}>{REMOTE_CHOOSER_COPY.private}</span>}
      {entry.kind === 'link' && <span className={TAG}>{REMOTE_CHOOSER_COPY.link}</span>}
    </button>
  );
}

// The path field: the folder shown, scrolled to its end while nothing is typed in it; what the person types, until the
// keyboard leaves it. Enter or Go asks for what it holds; Go keeps the keyboard in the field, so what it asks is what was
// typed. Chromium returns a text field's scroll to its start as the keyboard leaves it, whether or not its value changes,
// so the field scrolls to its end again on the next frame, once the keyboard is still elsewhere.
function PathField({ shown, disabled, go }: { shown: string; disabled: boolean; go(path: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = field.current;
    if (input !== null && draft === null) input.scrollLeft = input.scrollWidth;
  }, [shown, draft]);
  const left = () => {
    setDraft(null);
    requestAnimationFrame(() => {
      const input = field.current;
      if (input !== null && document.activeElement !== input) input.scrollLeft = input.scrollWidth;
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    go(draft ?? shown);
    setDraft(null);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        ref={field}
        type="text"
        data-chooser-path=""
        spellCheck={false}
        className={`${FIELD} min-w-0 flex-1 font-mono`}
        value={draft ?? shown}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={left}
      />
      <button type="submit" className={SECONDARY} disabled={disabled} onMouseDown={(event) => event.preventDefault()}>
        {REMOTE_CHOOSER_COPY.go}
      </button>
    </form>
  );
}
