// A notification's landing on a `<message>` in the session view (DC9 M6, from the owner's review of M4): the log's
// `message` event names the transcript row and span it came from (`src`, `<row uuid>#<span>`), so the view jumps to that
// row's text the way MAWS's own mark anchors do (its store's `jumpToMessage`, which opens the turn's working record when
// the report holds the text inside it) and marks the row, as a request's landing marks its card at the tail. The jump
// waits for the row: the transcript may still be hydrating, or the row still streaming. A row in history the view has
// not paged in is not paged for; the landing's notice already said the message is in the log.
import { useEffect, useState } from 'react';
import type { JsonObject } from 'desk-hub/protocol';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { MessageUuid } from '@shared/graph/ids';

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

/**
 * Where a message's text is in MAWS's transcript: the row its `src` names among the held rows, and the block holding
 * the mark (the first text block when none holds one), counted from the row's place in its API message as MAWS's
 * backfill counts it. Null while the row is not held, or for a `src` that names no row's text.
 */
export function messageAnchor(src: string, rows: readonly JsonObject[]): { messageUuid: MessageUuid; blockIndex: number } | null {
  const uuid = src.split('#', 1)[0];
  const row = rows.find((r) => r.uuid === uuid);
  const content = object(row?.message)?.content;
  if (!row || row.type !== 'assistant' || !Array.isArray(content)) return null;
  const texts = content.flatMap((block, i) => (object(block)?.type === 'text' && typeof object(block)!.text === 'string' ? [{ i, text: object(block)!.text as string }] : []));
  const block = texts.find((t) => t.text.includes('<message>')) ?? texts[0];
  if (block === undefined) return null;
  const base = typeof row.apiBlockIndex === 'number' ? row.apiBlockIndex : 0;
  return { messageUuid: uuid as MessageUuid, blockIndex: base + block.i };
}

/** Jumps the session view to the landed message's row once MAWS's store holds it, and marks the row while the view lasts. */
export function useLandOnMessage(root: HTMLElement | null, transcript: { key: string; heldRows(): readonly JsonObject[] }, src: string | null): void {
  const [landed, setLanded] = useState<{ src: string; row: string } | null>(null);
  useEffect(() => {
    if (src === null) return;
    let done = false;
    const settle = () => {
      if (done) return;
      const store = useTranscriptStore.getState();
      const entry = store.entries[transcript.key];
      if (!entry || entry.phase !== 'live') return;
      const anchor = messageAnchor(src, transcript.heldRows());
      if (anchor === null) return;
      done = true; // the jump's own store change calls back in here
      if (!store.jumpToMessage(transcript.key, anchor)) {
        done = false;
        return;
      }
      off();
      const row = useTranscriptStore.getState().entries[transcript.key]?.jump?.rowId;
      if (row) setLanded({ src, row });
    };
    const off = useTranscriptStore.subscribe(settle);
    settle();
    return () => {
      done = true;
      off();
    };
  }, [transcript, src]);

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
}
