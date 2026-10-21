// @vitest-environment happy-dom
// A landing on a `<message>` whose row is in history not yet held (`landed-message.ts`): it pages toward the row and,
// once the page has drawn it, jumps there — unless the reader moved while the page was out. Their wheel on the list,
// or focus taken elsewhere, leave them where they went, and the landing says nothing more. MAWS's real store holds the
// row; the transcript the landing reads holds it only once the page is answered.
import { act, cleanup, renderHook } from '@testing-library/react';
import type { JsonObject } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { readRecording } from '../../../test/double/session-stream';
import { freshSource, subagentLookupOf } from '../../depth/source/desk-transcript';
import { useLandOnMessage } from './landed-message';

const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

const recorded = readRecording().session;
const prompt = recorded[0];
const textRow = recorded.find((r) => r.type === 'assistant' && JSON.stringify(r.message).includes('"type":"text"'))!;
const answer: JsonObject = { ...textRow, uuid: 'landed-answer', parentUuid: String(prompt.uuid), message: { ...(textRow.message as JsonObject), id: 'msg_landed', content: [{ type: 'text', text: '<message>The migration is merged.</message>' }] } };
const SRC = 'landed-answer#0';

const opened: Array<() => void> = [];
afterEach(() => {
  opened.splice(0).forEach((close) => close());
  cleanup();
  document.body.replaceChildren();
});

async function scene() {
  const key = `landing-${Math.random()}`;
  const store = useTranscriptStore.getState();
  await store.attach(key, freshSource([prompt, answer], 'sess-1', subagentLookupOf([])), { agentId: null as never });
  opened.push(() => (store.detach(key), store.drop(key)));
  const root = document.createElement('section');
  const scroller = document.createElement('div');
  scroller.setAttribute('data-transcript-scroller', '');
  const composer = document.createElement('textarea');
  root.append(scroller, composer);
  document.body.append(root);
  let held: JsonObject[] = [];
  let asked = 0;
  const transcript = { key, heldRows: () => held, loadOlder: () => void (asked += 1) };
  const view = renderHook(({ loadingOlder }: { loadingOlder: boolean }) => useLandOnMessage(root, transcript, { phase: 'live', more: true, loadingOlder }, SRC), { initialProps: { loadingOlder: false } });
  expect(asked).toBeGreaterThan(0); // the row is not held: a page toward it (asked again until the page is out)
  expect(view.result.current).toBe('finding');
  view.rerender({ loadingOlder: true }); // the page is out
  /** The page is answered: the row is held now. */
  const answerPage = async () => {
    held = [prompt, answer];
    view.rerender({ loadingOlder: false });
    await act(() => frames(4));
  };
  const jumped = () => useTranscriptStore.getState().entries[key].jump !== null;
  return { view, scroller, composer, answerPage, jumped };
}

describe('a landing on a message paged toward', () => {
  it('jumps to the row once its page is drawn', async () => {
    const s = await scene();
    await s.answerPage();
    expect(s.jumped()).toBe(true);
    expect(s.view.result.current).toBeNull();
  });

  it('a reader who wheels while the page is out stays where they went, the landing saying nothing more', async () => {
    const s = await scene();
    await act(async () => void s.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 })));
    await s.answerPage();
    expect(s.jumped()).toBe(false);
    expect(s.view.result.current).toBeNull();
  });

  it('a reader who moves focus elsewhere while the page is out keeps it there', async () => {
    const s = await scene();
    await act(async () => s.composer.focus());
    await s.answerPage();
    expect(s.jumped()).toBe(false);
    expect(document.activeElement).toBe(s.composer);
  });
});

// An async question no request waits for (MAWS's own ask, never raised) lands on its call's row, by the call's id.
describe("a landing on an async question's call", () => {
  const asking = (id: string, name: string, input: JsonObject): JsonObject => ({
    ...textRow,
    uuid: `asked-${id}`,
    parentUuid: String(prompt.uuid),
    message: { ...(textRow.message as JsonObject), id: `msg_${id}`, content: [{ type: 'tool_use', id, name, input }] },
  });

  it.each([
    ['the ask mod', 'toolu_landed_mod', asking('toolu_landed_mod', 'mcp__doperpowers__AskUserQuestion', { questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes' }, { label: 'No' }] }] }), 'question:toolu_landed_mod'],
    ["MAWS's ask", 'toolu_landed_maws', asking('toolu_landed_maws', 'mcp__maws__ask', { blocking: false, questions: [{ question: 'Ship it?', modality: 'text' }] }), 'ask:toolu_landed_maws'],
  ])("jumps to %s's row once it is held", async (_, id, call, row) => {
    const key = `landing-${Math.random()}`;
    const store = useTranscriptStore.getState();
    await store.attach(key, freshSource([prompt, call], 'sess-1', subagentLookupOf([])), { agentId: null as never });
    opened.push(() => (store.detach(key), store.drop(key)));
    const root = document.createElement('section');
    const scroller = document.createElement('div');
    scroller.setAttribute('data-transcript-scroller', '');
    root.append(scroller);
    document.body.append(root);
    const transcript = { key, heldRows: () => [prompt, call], loadOlder: () => {} };
    const view = renderHook(() => useLandOnMessage(root, transcript, { phase: 'live', more: false, loadingOlder: false }, id, 'question'));
    await act(() => frames(2));
    expect(useTranscriptStore.getState().entries[key].jump?.rowId).toBe(row);
    expect(view.result.current).toBeNull();
  });
});

// A `message` event names a `<message>`'s span (`<row uuid>#<span>`) or, for a message sent through a message tool, its
// call (the tool-use id): the landing reaches the span's text row, or the `to_human` row MAWS draws for the accepted call.
describe('a landing on a message', () => {
  const resultRow = recorded.find((r) => r.type === 'user' && JSON.stringify(r.message).includes('"tool_result"'))!;
  /** A message tool's accepted call: its row, and its result's (`sent`). */
  const sent = (id: string, name: string, text: string): JsonObject[] => [
    { ...textRow, uuid: `call-${id}`, parentUuid: String(prompt.uuid), message: { ...(textRow.message as JsonObject), id: `msg_${id}`, content: [{ type: 'tool_use', id, name, input: { text } }] } },
    { ...resultRow, uuid: `sent-${id}`, parentUuid: `call-${id}`, sourceToolAssistantUUID: `call-${id}`, toolUseResult: [{ type: 'text', text: 'sent' }], message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'sent' }] }] } },
  ];

  it.each([
    ['a `<message>` span', SRC, [answer], /^text:/],
    ["MAWS's message tool", 'toolu_landed_mawsmsg', sent('toolu_landed_mawsmsg', 'mcp__maws__message', 'Stage 1 of 4 is done.'), /^to-human:toolu_landed_mawsmsg$/],
    ["the to-human plugin's message tool", 'toolu_landed_pluginmsg', sent('toolu_landed_pluginmsg', 'mcp__to-human__message', 'Stage 2 of 4 is done.'), /^to-human:toolu_landed_pluginmsg$/],
  ])('jumps to the row of %s once it is held', async (_, src, rows, row) => {
    const key = `landing-${Math.random()}`;
    const store = useTranscriptStore.getState();
    await store.attach(key, freshSource([prompt, ...rows], 'sess-1', subagentLookupOf([])), { agentId: null as never });
    opened.push(() => (store.detach(key), store.drop(key)));
    const root = document.createElement('section');
    const scroller = document.createElement('div');
    scroller.setAttribute('data-transcript-scroller', '');
    root.append(scroller);
    document.body.append(root);
    const transcript = { key, heldRows: () => [prompt, ...rows], loadOlder: () => {} };
    const view = renderHook(() => useLandOnMessage(root, transcript, { phase: 'live', more: false, loadingOlder: false }, src, 'message'));
    await act(() => frames(2));
    const entry = useTranscriptStore.getState().entries[key];
    expect(entry.jump?.rowId).toMatch(row);
    expect(entry.rows.find((r) => r.id === entry.jump?.rowId)?.kind).toBe(src === SRC ? 'assistant_text' : 'to_human');
    expect(view.result.current).toBeNull(); // landed: nothing to say
  });
});
