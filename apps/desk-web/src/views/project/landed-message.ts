// A notification's landing on a `<message>` in the session view (DC9 M6, from the owner's review of M4): the log's
// `message` event names the transcript row and span it came from (`src`, `<row uuid>#<span>`, the span counted among the
// row's marked spans across its text blocks as sminos's `host_events` counts them), so the view jumps to the block
// holding that span the way MAWS's own mark anchors do (its store's `jumpToMessage`, which opens the turn's working
// record when the report holds the text inside it) and marks the row, as a request's landing marks its card at the tail.
// The jump waits for the row: the transcript may still be hydrating, or the row may lie in history the view has not
// paged in, which it pages toward, saying so, until the row is held or no older rows are left (then it says the row is
// not in the transcript). A reader who moves while it waits — a wheel, a touch, a press or the keys on the list, focus
// taken elsewhere (`reader-intent.ts`) — keeps the place they went to: the landing ends there and says nothing more.
//
// An async question with no request waiting at the tail (MAWS's own ask, never raised; or one answered already) lands
// the same way on its call's row: the log's `question` event's `src` is the call's tool-use id, by which MAWS keys the
// row (a question's `question:<id>`, MAWS's ask capsule `ask:<id>`), so the view jumps to it as its store's `jumpTo` does.
// So does a message sent through a message tool (the to-human plugin's, or MAWS's former one in a recorded session,
// which MAWS reads alike, `@shared/owner/message-call`; doperpowers' to-human message tool spec, its cross-repo
// contract): its `message` event's `src` is the call's tool-use id, not a span, and MAWS's store draws the call as the
// message it sends, a `to_human` row keyed `to-human:<id>` (P4-R7).
import { useEffect, useRef, useState } from 'react';
import type { JsonObject } from 'desk-hub/protocol';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { presentationOf } from '../../../../../src/renderer/src/transcript/model/classify';
import { rowId } from '../../../../../src/renderer/src/transcript/model/keys';
import { marksOfText } from '../../../../../src/renderer/src/transcript/model/owner-marks';
import type { RowId } from '../../../../../src/renderer/src/transcript/model/rows';
import type { MessageUuid, ToolUseId } from '@shared/graph/ids';
import { watchReaderIntent } from '../../depth/view/reader-intent';

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

type Anchor = { messageUuid: MessageUuid; blockIndex: number };

/**
 * What a landing lands on: a message (`src` `<row uuid>#<span>` for a `<message>`, the call's tool-use id for a message
 * tool's) or an async question's call (`src` its tool-use id).
 */
export type LandingKind = 'message' | 'question';

/**
 * Where a message's text is in MAWS's transcript: the row its `src` names among the held rows, and the text block
 * holding the span its `src` counts (marked spans in MAWS's grammar, `<message>` and its aliases, never inside code,
 * counted across the row's text blocks in order), its index taken from the row's place in its API message as MAWS's
 * backfill counts it. Null while the row is not held, or for a `src` that names no span of a row's text.
 */
export function messageAnchor(src: string, rows: readonly JsonObject[]): Anchor | null {
  const hash = src.indexOf('#');
  const uuid = hash < 0 ? src : src.slice(0, hash);
  const span = hash < 0 ? 0 : Number(src.slice(hash + 1));
  if (!Number.isInteger(span) || span < 0) return null;
  const row = rows.find((r) => r.uuid === uuid);
  const content = object(row?.message)?.content;
  if (!row || row.type !== 'assistant' || !Array.isArray(content)) return null;
  let seen = 0;
  for (const [i, block] of content.entries()) {
    const text = object(block)?.type === 'text' ? object(block)!.text : undefined;
    if (typeof text !== 'string') continue;
    seen += marksOfText(text).parts.filter((part) => part.kind !== 'plain' && part.text !== '').length;
    if (span < seen) return { messageUuid: uuid as MessageUuid, blockIndex: (typeof row.apiBlockIndex === 'number' ? row.apiBlockIndex : 0) + i };
  }
  return null;
}

/**
 * The row of a call in MAWS's transcript, once a held row holds the call (`src`, its tool-use id): MAWS's ask capsule
 * for its own `ask`, the message's row for a message tool's call, a question row for the ask mod's. Null while no held
 * row holds it.
 */
export function callRow(src: string, rows: readonly JsonObject[]): RowId | null {
  for (const row of rows) {
    const content = object(row.message)?.content;
    if (row.type !== 'assistant' || !Array.isArray(content)) continue;
    const use = content.map(object).find((block) => block?.type === 'tool_use' && block.id === src);
    if (!use) continue;
    switch (presentationOf(String(use.name))) {
      case 'ask':
        return rowId.ask(src as ToolUseId);
      case 'message':
        return rowId.toHuman(src as ToolUseId);
      default:
        return rowId.question(src as ToolUseId);
    }
  }
  return null;
}

/**
 * What a landing does next: jump to its row once it is held and MAWS's store is live; page toward it while older rows
 * exist; wait while a page is out or the transcript is not in; and say it is missing once no older rows are left.
 */
export function landingStep(input: { held: boolean; live: boolean; more: boolean; loadingOlder: boolean }): 'jump' | 'page' | 'wait' | 'missing' {
  if (!input.live) return 'wait';
  if (input.held) return 'jump';
  if (input.loadingOlder) return 'wait';
  return input.more ? 'page' : 'missing';
}

/**
 * The jump to a landing's row in MAWS's store under `key`, once a held row holds it (null before), answering whether
 * the store found the row: it may not have derived it yet. A message's `src` names a span of a held row's text, or else
 * the call of a message tool: a tool-use id is never a row's uuid.
 */
function rowJump(kind: LandingKind, src: string, key: string, rows: readonly JsonObject[]): (() => boolean) | null {
  const store = () => useTranscriptStore.getState();
  const anchor = kind === 'message' ? messageAnchor(src, rows) : null;
  if (anchor) return () => store().jumpToMessage(key, anchor);
  const row = callRow(src, rows);
  return (
    row &&
    (() => {
      const before = store().entries[key]?.jump ?? null;
      store().jumpTo(key, row);
      const after = store().entries[key]?.jump ?? null;
      return after !== before && after?.focus === row;
    })
  );
}

/** What the landing reads of the session's transcript (its `DeskTranscript`). */
type Landable = { key: string; heldRows(): readonly JsonObject[]; loadOlder(): void };

/** Where a landing stands, for the view to say: paging toward its row, or the row not in the transcript. */
export type LandingNotice = 'finding' | 'missing' | null;

/**
 * Jumps the session view to the landed message's row (or, for `kind` `question`, its call's row) once MAWS's store
 * holds it, paging toward it while it is in history not yet held, and marks the row while the view lasts. Answers what
 * the view should say meanwhile.
 */
export function useLandOnMessage(root: HTMLElement | null, transcript: Landable, state: { phase: string; more: boolean; loadingOlder: boolean }, src: string | null, kind: LandingKind = 'message'): LandingNotice {
  const [landed, setLanded] = useState<{ src: string; row: string | null } | null>(null);
  const [paging, setPaging] = useState<string | null>(null);
  // The landing the reader moved away from (its src), at once for the effect below and as state for the view.
  const [yielded, setYielded] = useState<string | null>(null);
  const gaveWay = useRef<string | null>(null);
  const jumping = useRef(false); // the landing is moving the list and focus itself: none of that is the reader's
  const gone = src !== null && yielded === src;
  const settled = (landed !== null && landed.src === src) || gone;
  const { phase, more, loadingOlder } = state;

  useEffect(() => {
    const scroller = root?.querySelector<HTMLElement>('[data-transcript-scroller]');
    if (!scroller || src === null || settled) return;
    jumping.current = false;
    return watchReaderIntent(
      scroller,
      () => {
        if (jumping.current) return;
        gaveWay.current = src;
        setYielded(src);
      },
      { focus: true },
    );
  }, [root, src, settled]);

  useEffect(() => {
    if (src === null || settled) return;
    let done = false;
    let frame = 0;
    const jump = (to: () => boolean) => {
      done = true; // the jump's own store change calls back in here
      jumping.current = true;
      if (!to()) {
        done = false;
        jumping.current = false;
        return;
      }
      off();
      setLanded({ src, row: useTranscriptStore.getState().entries[transcript.key]?.jump?.rowId ?? null });
    };
    const settle = () => {
      if (done || frame !== 0 || gaveWay.current === src) return;
      const entry = useTranscriptStore.getState().entries[transcript.key];
      const to = rowJump(kind, src, transcript.key, transcript.heldRows());
      switch (landingStep({ held: to !== null, live: phase === 'live' && entry?.phase === 'live', more, loadingOlder })) {
        case 'page':
          setPaging(src);
          return transcript.loadOlder();
        case 'missing':
          done = true;
          return setLanded({ src, row: null });
        case 'jump':
          if (paging !== src) return jump(to!);
          // A page that lands holds the reader's place frame by frame against the list's own scrolling (`keep-place.ts`),
          // which a jump is. The tap is the reader's: once the page is drawn, the reader's intent ends that hold (as their
          // wheel would), and the jump goes where the tap asked.
          frame = requestAnimationFrame(() =>
            (frame = requestAnimationFrame(() => {
              frame = 0;
              if (gaveWay.current === src) return; // the reader moved while the page was out: their place stands
              jumping.current = true;
              root?.querySelector('[data-transcript-scroller]')?.dispatchEvent(new WheelEvent('wheel'));
              jump(to!);
            })),
          );
      }
    };
    const off = useTranscriptStore.subscribe(settle);
    settle();
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      off();
    };
  }, [transcript, src, kind, settled, phase, more, loadingOlder, paging, root]);

  const row = landed !== null && landed.src === src ? landed.row : null;
  useEffect(() => {
    if (!root || row === null) return;
    // The list is virtualized: the row's element comes and goes as the reader scrolls, so it is marked again whenever
    // it is drawn anew.
    const selector = `[data-row-id="${CSS.escape(row)}"]`;
    const mark = () => root.querySelectorAll(selector).forEach((element) => element.hasAttribute('data-landed') || element.setAttribute('data-landed', ''));
    let frame = 0;
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        mark();
      });
    });
    mark();
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      root.querySelectorAll('[data-row-id][data-landed]').forEach((element) => element.removeAttribute('data-landed'));
    };
  }, [root, row]);

  if (src === null || gone) return null;
  if (settled) return landed!.row === null ? 'missing' : null;
  return paging === src ? 'finding' : null;
}
