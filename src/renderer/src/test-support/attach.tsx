// What the suites of "Attach selection to chat" stand on (UX wave U6b-5a, M2; docs/doperpowers/plans/2026-11-17-ux-wave-
// U6b-5-rest-of-keyboard.md, "What it proves"): a session's draft store as a fake with the real store's rule for
// `replaces` (`DraftStore.set`, src/services/index/drafts.ts; build F's rule at f1852de3a beside it), whose commands the
// test may hold, letting a held write land and answering it apart; and a composer as the Composer registers it (the
// real editor, its port, and the focus target's `attachPasted` through `takeIntoBox`), mounted and unmounted at will.
import { act, render, waitFor } from '@testing-library/react';
import type { JSONContent } from '@tiptap/core';
import { createRef, useEffect, useRef } from 'react';
import { expect, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { DRAFT_CLAIM, DRAFT_KEPT_WORDS, settles, STAGED_DRAFT_WORDS, STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { attachPasted, takeIntoBox, type AttachOutcome } from '../composer/attach-pasted';
import { ipcDrafts, type DraftPort } from '../composer/editor/controller';
import { docOf, paragraph, PASTED, textNode, type ComposerDoc } from '../composer/editor/doc';
import { rememberingRemoteDrafts } from '../composer/editor/drafts';
import { Editor, type EditorHandle } from '../composer/editor/Editor';
import type { Serialized } from '../composer/editor/serialize';
import { registerFocusTarget } from '../stores/composer';

type Result = CommandResult<'session.drafts.set'> | CommandResult<'session.drafts.get'>;
type Name = 'session.drafts.get' | 'session.drafts.set';
type SetInput = { appSessionId: AppSessionId; draft: Draft | null; replaces?: string | null };

const ok = (value: unknown = undefined): Result => ({ ok: true, value }) as Result;
const failure = (code: 'internal' | 'timeout' | 'host_unavailable', message: string, issues?: unknown): Result => ({ ok: false, error: { code, message, ...(issues !== undefined && { issues }) } });
export const TIMEOUT = failure('timeout', 'the service took the request but has not confirmed it');
export const NOT_OFFERED = failure('internal', 'not offered', { refusal: 'not-offered' });

/** A command the test holds: it lands (a write is applied, a read is read) and is answered when the test says. */
export interface Held {
  name: Name;
  input: SetInput | { appSessionId: AppSessionId };
  landed: boolean;
  answered: boolean;
  /** Applies a write to the store (or reads, for a read) now; the result is kept for `answer`. */
  land(): Result;
  /** Answers with what it landed as (landing it first if it has not), or with the result given. */
  answer(result?: Result): Promise<void>;
}

/**
 * A session's draft store. `overLink`: read as the machine link answers (a cleared draft with its stamp), else as this
 * Mac's window reads it (a cleared draft as none). `rule`: this build's (`DRAFT_CLAIM`, a stage) or build F's (every
 * `replaces` a revision). Every command is answered at once unless held; `delayMs` answers each after that long.
 */
export function draftStore(appSessionId: AppSessionId, options: { overLink?: boolean; rule?: 'this-build' | 'build-f'; delayMs?: number } = {}) {
  const { overLink = false, rule = 'this-build' } = options;
  let row: (Draft & { cleared: boolean }) | null = null;
  let known = true;
  let offered = true;
  let readFails: Result | null = null;
  let stamps = 0;
  const holds: Name[] = [];
  const held: Held[] = [];
  const writes: SetInput[] = [];
  let reads = 0;
  let accepted = 0;
  const afterRead: (() => void)[] = [];

  const kept = (): Draft | null => {
    if (row === null) return null;
    if (row.cleared) return overLink ? { doc: null, attachments: [], updatedAt: row.updatedAt } : null;
    return { doc: row.doc, attachments: row.attachments, updatedAt: row.updatedAt };
  };
  const isStage = (draft: Draft) => typeof (draft.doc as { attrs?: { takeBack?: unknown } } | null)?.attrs?.takeBack === 'object';

  const read = (): Result => {
    if (!offered) return NOT_OFFERED;
    if (!known) return failure('internal', `unknown app session: ${appSessionId}`);
    if (readFails !== null) return readFails;
    return ok(kept());
  };
  const write = (input: SetInput): Result => {
    if (!offered) return NOT_OFFERED;
    if (!known) return failure('internal', `unknown app session: ${appSessionId}`);
    const { draft, replaces } = input;
    const now = row !== null && !row.cleared ? row : null;
    if (rule === 'this-build') {
      if (now !== null && isStage(now)) {
        if (replaces !== settles(now.updatedAt)) return failure('internal', STAGED_DRAFT_WORDS);
      } else if (replaces === DRAFT_CLAIM) {
        if (now !== null) return failure('internal', DRAFT_KEPT_WORDS);
      } else if (replaces?.startsWith('settle:')) return failure('internal', STALE_DRAFT_WORDS);
      else if (replaces !== undefined && (row?.updatedAt ?? null) !== replaces) return failure('internal', STALE_DRAFT_WORDS);
    } else if (replaces !== undefined && (row?.updatedAt ?? null) !== replaces) return failure('internal', STALE_DRAFT_WORDS);
    stamps += 1;
    row = draft === null ? { doc: null, attachments: [], updatedAt: `2026-11-17T12:00:00.000Z#cleared-${stamps}`, cleared: true } : { ...draft, cleared: false };
    accepted += 1;
    return ok();
  };
  const run = (name: Name, input: SetInput | { appSessionId: AppSessionId }): Result => {
    if (name === 'session.drafts.set') return write(input as SetInput);
    reads += 1;
    const result = read();
    afterRead.splice(0).forEach((then) => then());
    return result;
  };

  const client = {
    localMachine: TEST_MACHINE,
    on: () => () => {},
    pathForFile: () => '',
    invoke: vi.fn(async (name: string, input: unknown): Promise<unknown> => {
      if (name === 'session.history.list') return ok({ entries: [] });
      if (name !== 'session.drafts.get' && name !== 'session.drafts.set') return failure('internal', `no ${name} here`);
      if (name === 'session.drafts.set') writes.push(input as SetInput);
      const at = holds.indexOf(name);
      if (at >= 0) {
        holds.splice(at, 1);
        return new Promise<Result>((resolve) => {
          let landedAs: Result | null = null;
          const call: Held = {
            name,
            input: input as SetInput,
            landed: false,
            answered: false,
            land() {
              if (!call.landed) landedAs = run(name, input as SetInput);
              call.landed = true;
              return landedAs!;
            },
            async answer(result) {
              const given = result ?? call.land();
              call.answered = true;
              resolve(given);
              await settle();
            },
          };
          held.push(call);
        });
      }
      const result = run(name, input as SetInput);
      if (options.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return result;
    }),
  } as unknown as MawsBridge;

  return {
    client,
    /** The next command of this name is held, as are further ones for each call. */
    hold(name: Name, count = 1) {
      for (let i = 0; i < count; i++) holds.push(name);
    },
    /** The commands held of this name, in the order they came, answered or not. */
    held: (name: Name) => held.filter((call) => call.name === name),
    /** Another writer (another composer, another device): a draft kept now, at its own revision. */
    put(doc: ComposerDoc | null, updatedAt = `2026-11-17T11:00:00.000Z#other-${++stamps}`) {
      row = doc === null ? { doc: null, attachments: [], updatedAt, cleared: true } : { doc, attachments: [], updatedAt, cleared: false };
    },
    /** Runs once after the next read has been read (another writer between a read and the write after it). */
    afterNextRead(then: () => void) {
      afterRead.push(then);
    },
    forget() {
      known = false;
    },
    refuseDrafts() {
      offered = false;
    },
    failReads(result: Result | null) {
      readFails = result;
    },
    /** The document kept now (null: none, or cleared), and its revision. */
    doc: (): ComposerDoc | null => (row === null || row.cleared ? null : (row.doc as ComposerDoc)),
    revision: () => row?.updatedAt ?? null,
    writes: () => writes,
    reads: () => reads,
    accepted: () => accepted,
  };
}
export type DraftStoreFake = ReturnType<typeof draftStore>;

/** Lets held promises and React's work settle, under the suite's fake timers or real ones. */
export async function settle(): Promise<void> {
  if (vi.isFakeTimers()) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  else await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
}

// The pasted nodes of a document, in order.
export function blocksOf(doc: JSONContent | null | undefined): JSONContent[] {
  if (!doc || typeof doc !== 'object') return [];
  return [...(doc.type === PASTED ? [doc] : []), ...(doc.content ?? []).flatMap((child) => blocksOf(child))];
}
/** The blocks an attach made (its id begins `attach-`) in a document. */
export const attachedIn = (doc: JSONContent | null | undefined): JSONContent[] => blocksOf(doc).filter((node) => String(node.attrs?.id).startsWith('attach-'));
/** The document's plain text, a block as its text: what the person typed is found in it. */
export const textOf = (doc: JSONContent | null | undefined): string => {
  if (!doc || typeof doc !== 'object') return '';
  if (doc.type === 'text') return doc.text ?? '';
  if (doc.type === PASTED) return '';
  return (doc.content ?? []).map((child) => textOf(child)).join(doc.type === 'doc' ? '\n' : '');
};

/**
 * A composer for the session, mounted as the Composer mounts one: the real editor over its port (the window's
 * `session.drafts.*` on this Mac, the remote queue over the link), and a focus target whose `attachPasted` is the
 * Composer's (`takeIntoBox`). `covered`: a card holds its box. `inert`: its pane is covered (a maximized side column).
 */
export function mountComposer(appSessionId: AppSessionId, client: MawsBridge, options: { overLink?: boolean; covered?: boolean; inert?: boolean; disabled?: string | null; port?: DraftPort; onSubmit?: (s: Serialized) => Promise<boolean> } = {}) {
  const handle = createRef<EditorHandle>();
  const base = options.port ?? ipcDrafts(client, appSessionId);
  const port = options.overLink ? rememberingRemoteDrafts(base, appSessionId, () => true, client) : base;
  function Box() {
    const root = useRef<HTMLElement>(null);
    useEffect(
      () =>
        registerFocusTarget(appSessionId, {
          focusEditor: () => handle.current?.focus(),
          focusFrame: () => handle.current?.focus(),
          insertText: (text) => handle.current?.insertText(text),
          attachPasted: (block, by) => takeIntoBox(handle.current, block, by, { element: root.current, covered: options.covered ?? false }),
        }),
      [],
    );
    return (
      <div inert={options.inert ?? false}>
        <section ref={root} aria-label="Composer">
          <Editor appSessionId={appSessionId} cwd="/work" sessionId={null} drafts={port} client={client} handle={handle} disabled={options.disabled ?? null} {...(options.onSubmit && { onSubmit: options.onSubmit })} />
        </section>
      </div>
    );
  }
  const view = render(<Box />);
  const editor = () => handle.current!;
  return {
    handle,
    editor,
    restored: () => act(async () => editor().restored()),
    type: (text: string) => act(() => editor().insertText(text)),
    send: () => act(() => editor().submit()),
    unmount: () => act(() => view.unmount()),
    content: () => view.container.querySelector('[contenteditable]') as HTMLElement,
  };
}
export type MountedComposer = ReturnType<typeof mountComposer>;

/** A send the test answers: each submission waits until the test settles it, and the serialised message is kept. */
export function heldSends() {
  const sent: Serialized[] = [];
  const answers: ((accepted: boolean) => void)[] = [];
  return {
    sent,
    onSubmit: (s: Serialized) => {
      sent.push(s);
      return new Promise<boolean>((resolve) => answers.push(resolve));
    },
    answer: async (accepted: boolean) => {
      answers.shift()!(accepted);
      await settle();
    },
  };
}

/** One attach, its outcome watched: `said` is what it ended on (null while it has not ended), `times` how often it ended. */
export function attachOf(store: DraftStoreFake, session: AppSessionId, text = 'npm test\n3 failed') {
  const watch = { said: null as AttachOutcome | null, times: 0 };
  const done = attachPasted(session, text, store.client).then((outcome) => {
    watch.said = outcome;
    watch.times += 1;
    return outcome;
  });
  return Object.assign(watch, { done });
}

/** Two of the three claims at an end: the document holds exactly one block of the attach, and what the person typed. */
export function holdsOnce(doc: ComposerDoc | null | undefined, ...typed: string[]): void {
  expect(attachedIn(doc)).toHaveLength(1);
  for (const words of typed) expect(textOf(doc)).toContain(words.trim());
}

/** The `nth` write held (from 0), once it has come. Not under fake timers, where `waitFor` would wait on a faked clock. */
export async function heldWrite(store: DraftStoreFake, nth = 0): Promise<Held> {
  await waitFor(() => expect(store.held('session.drafts.set').length).toBeGreaterThan(nth));
  return store.held('session.drafts.set')[nth]!;
}

/** Another writer between each of the next `rounds` reads and the write after it, so each such write is answered stale. */
export function staleRounds(store: DraftStoreFake, rounds: number, after?: (round: number) => void): void {
  let round = 0;
  const other = () => {
    round += 1;
    store.put(docOf([paragraph(textNode(`another writer ${round}`))]));
    after?.(round);
    if (round < rounds) store.afterNextRead(other);
  };
  store.afterNextRead(other);
}
