// A notification's landing on a `<message>` in the session view (DC9 M6, from the owner's review of M4): the log's
// `message` event names the transcript row and span it came from (`src`, `<row uuid>#<span>`, the span counted among the
// row's marked spans across its text blocks as sminos's `host_events` counts them), so the view jumps to the block
// holding that span the way MAWS's own mark anchors do (its store's `jumpToMessage`, which opens the turn's working
// record when the report holds the text inside it) and marks the row, as a request's landing marks its card at the tail.
// The jump waits for the row: the transcript may still be hydrating, or the row may lie in history the view has not
// paged in, which it pages toward, saying so, until the row is held or no older rows are left (then it says the row is
// not in the transcript).
import { useEffect, useState } from 'react';
import type { JsonObject } from 'desk-hub/protocol';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { marksOfText } from '../../../../../src/renderer/src/transcript/model/owner-marks';
import type { MessageUuid } from '@shared/graph/ids';

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

type Anchor = { messageUuid: MessageUuid; blockIndex: number };

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
 * What a landing does next: jump to its row once it is held and MAWS's store is live; page toward it while older rows
 * exist; wait while a page is out or the transcript is not in; and say it is missing once no older rows are left.
 */
export function landingStep(input: { anchor: Anchor | null; live: boolean; more: boolean; loadingOlder: boolean }): 'jump' | 'page' | 'wait' | 'missing' {
  if (!input.live) return 'wait';
  if (input.anchor !== null) return 'jump';
  if (input.loadingOlder) return 'wait';
  return input.more ? 'page' : 'missing';
}

/** What the landing reads of the session's transcript (its `DeskTranscript`). */
type Landable = { key: string; heldRows(): readonly JsonObject[]; loadOlder(): void };

/** Where a landing stands, for the view to say: paging toward its row, or the row not in the transcript. */
export type LandingNotice = 'finding' | 'missing' | null;

/**
 * Jumps the session view to the landed message's row once MAWS's store holds it, paging toward it while it is in
 * history not yet held, and marks the row while the view lasts. Answers what the view should say meanwhile.
 */
export function useLandOnMessage(root: HTMLElement | null, transcript: Landable, state: { phase: string; more: boolean; loadingOlder: boolean }, src: string | null): LandingNotice {
  const [landed, setLanded] = useState<{ src: string; row: string | null } | null>(null);
  const [paging, setPaging] = useState<string | null>(null);
  const settled = landed !== null && landed.src === src;
  const { phase, more, loadingOlder } = state;
  useEffect(() => {
    if (src === null || settled) return;
    let done = false;
    let frame = 0;
    const jump = (anchor: Anchor) => {
      done = true; // the jump's own store change calls back in here
      if (!useTranscriptStore.getState().jumpToMessage(transcript.key, anchor)) {
        done = false;
        return;
      }
      off();
      setLanded({ src, row: useTranscriptStore.getState().entries[transcript.key]?.jump?.rowId ?? null });
    };
    const settle = () => {
      if (done || frame !== 0) return;
      const entry = useTranscriptStore.getState().entries[transcript.key];
      const anchor = messageAnchor(src, transcript.heldRows());
      switch (landingStep({ anchor, live: phase === 'live' && entry?.phase === 'live', more, loadingOlder })) {
        case 'page':
          setPaging(src);
          return transcript.loadOlder();
        case 'missing':
          done = true;
          return setLanded({ src, row: null });
        case 'jump':
          if (paging !== src) return jump(anchor!);
          // A page that lands holds the reader's place frame by frame against the list's own scrolling (`keep-place.ts`),
          // which a jump is. The tap is the reader's: once the page is drawn, the reader's intent ends that hold (as their
          // wheel would), and the jump goes where the tap asked.
          frame = requestAnimationFrame(() =>
            (frame = requestAnimationFrame(() => {
              frame = 0;
              root?.querySelector('[data-transcript-scroller]')?.dispatchEvent(new WheelEvent('wheel'));
              jump(anchor!);
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
  }, [transcript, src, settled, phase, more, loadingOlder, paging, root]);

  const row = settled ? landed.row : null;
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

  if (src === null) return null;
  if (settled) return landed.row === null ? 'missing' : null;
  return paging === src ? 'finding' : null;
}
