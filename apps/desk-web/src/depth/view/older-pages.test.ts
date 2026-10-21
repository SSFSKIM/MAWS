// @vitest-environment happy-dom
// Older rows are paged in until a page adds a drawn row or none remain: an empty list cannot scroll, and a page of
// records that draw nothing (attachments, progress) must not leave the reader stuck at the top.
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import type { JsonObject } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from 'zustand';
import { useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, rowsBefore, scriptOf } from '../../../test/double/session-stream';
import { DeskTranscript } from '../source/desk-transcript';
import { drawnRows, useDrawnRowCount } from './drawn-rows';
import { useOlderPages } from './older-pages';

const recorded = readRecording().session;
// The recording's prompt, nine of its attachments (which draw nothing), and a second prompt after them.
const prompt = recorded[0];
const attachments = Array.from({ length: 9 }, (_, i) => ({ ...recorded.filter((row) => row.type === 'attachment')[i % 3], uuid: `attachment-${i}` }));
const second = { ...prompt, uuid: 'second-prompt', message: { role: 'user', content: 'And one more thing.' } };
// One turn as the report folds it: its prompt, nine responses of unmarked text (its working record's, hidden while the
// record is closed), and a marked answer.
const textRow = recorded.find((row) => row.type === 'assistant' && JSON.stringify(row.message).includes('"type":"text"'))!;
const said = (uuid: string, parent: string, text: string) => ({ ...textRow, uuid, parentUuid: parent, message: { ...(textRow.message as JsonObject), id: `msg_${uuid}`, content: [{ type: 'text', text }] } });
const workRows = Array.from({ length: 9 }, (_, i) => said(`work-${i}`, i === 0 ? String(prompt.uuid) : `work-${i - 1}`, `Working on step ${i}.`));
const markedTurn = [prompt, ...workRows, said('answer', 'work-8', '<message>All nine steps are done.</message>')];

/** A scroller of the given geometry, as MAWS's list hands it out. */
function scroller(geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }): RefObject<TranscriptListHandle | null> {
  const element = document.createElement('div');
  for (const key of ['scrollHeight', 'clientHeight', 'scrollTop'] as const) Object.defineProperty(element, key, { get: () => geometry[key], configurable: true });
  return { current: { scrollElement: element, following: true, scrollToEnd: () => {}, scrollToIndex: () => {} } as unknown as TranscriptListHandle };
}

afterEach(cleanup);

describe('paging older rows in', () => {
  const opened: Array<() => void> = [];
  afterEach(() => opened.splice(0).forEach((close) => close()));

  function open(rows: JsonObject[], limit: number, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }, options: { report?: boolean } = {}) {
    const plane = new FakePlane('proj');
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: `s-${Math.random()}`, agentId: null }, store: useTranscriptStore });
    controller.open();
    const unmount = mount(controller, useTranscriptStore);
    // The session view's owner lane, told to the store again whenever its key's state starts over, as MAWS's view does.
    const lane = options.report ? useTranscriptStore.subscribe((s) => s.entries[controller.key] && s.entries[controller.key].state.ui.ownerLane !== true && s.setOwnerLane(controller.key, true)) : () => {};
    const list = scroller(geometry);
    renderHook(() => useOlderPages(controller, list, useStore(controller.state)));
    opened.push(() => (lane(), unmount(), controller.close(), useTranscriptStore.getState().drop(controller.key)));
    const script = scriptOf(rows, null);
    const answer = async () => {
      const { before } = plane.current.asked.at(-1)!;
      await act(async () => {
        plane.send('rows', rowsBefore(script, script.length, before, limit));
        await settle();
        await settle();
      });
    };
    return { plane, controller, list, script, answer };
  }

  it('a snapshot of rows that draw nothing pages on until one is drawn, though the empty list cannot scroll', async () => {
    expect(attachments).toHaveLength(9);
    const { plane, controller, script, answer } = open([prompt, ...attachments], 3, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    await act(async () => {
      plane.snapshot(script, script.length, 3); // the newest three: attachments
      await settle();
      await settle();
    });
    expect(useTranscriptStore.getState().entries[controller.key].rows).toEqual([]); // nothing drawn, so nothing to scroll
    expect(plane.current.asked).toHaveLength(1);
    await answer(); // three more attachments
    expect(plane.current.asked).toHaveLength(2);
    await answer(); // the last three
    expect(plane.current.asked).toHaveLength(3);
    await answer(); // the prompt: drawn, and no older rows remain
    expect(plane.current.asked).toHaveLength(3);
  });

  it('a page that draws nothing new while the reader is at the top asks for the next', async () => {
    const geometry = { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 };
    const { plane, list, script, answer } = open([prompt, ...attachments, second], 3, geometry);
    await act(async () => {
      plane.snapshot(script, script.length, 1); // the second prompt alone: drawn, filling the pane, the reader at its end
      await settle();
      await settle();
    });
    expect(plane.current.asked).toHaveLength(0); // nothing asked while the reader reads the end
    geometry.scrollTop = 0; // the reader scrolls to the top
    await act(async () => void list.current!.scrollElement!.dispatchEvent(new Event('scroll')));
    expect(plane.current.asked).toHaveLength(1);
    await answer(); // attachments: nothing new drawn, the reader still at the top
    expect(plane.current.asked).toHaveLength(2);
    await answer();
    expect(plane.current.asked).toHaveLength(3);
    await answer();
    expect(plane.current.asked).toHaveLength(4);
    await answer(); // the first prompt, and nothing older
    expect(plane.current.asked).toHaveLength(4);
  });

  it('in the report, a page whose rows all fold into a closed working record draws nothing new, and the next is asked for', async () => {
    const geometry = { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 };
    const { plane, controller, list, script, answer } = open(markedTurn, 3, geometry, { report: true });
    await act(async () => {
      plane.snapshot(script, script.length, 2); // the last unmarked response and the marked answer: a record and its mark
      await settle();
      await settle();
    });
    const drawn = () => drawnRows(controller.key, []).map((row) => row.id);
    const before = drawn();
    expect(before.some((id) => id.startsWith('owner-record:'))).toBe(true);
    expect(plane.current.asked).toHaveLength(0);
    geometry.scrollTop = 0; // the reader scrolls to the top
    await act(async () => void list.current!.scrollElement!.dispatchEvent(new Event('scroll')));
    expect(plane.current.asked).toHaveLength(1);
    const held = useTranscriptStore.getState().entries[controller.key].rows.length;
    await answer(); // three more unmarked responses: rows held, none drawn
    expect(useTranscriptStore.getState().entries[controller.key].rows.length).toBeGreaterThan(held);
    expect(drawn()).toHaveLength(before.length); // the turn's time row renamed for its new first event, nothing added
    expect(plane.current.asked).toHaveLength(2);
    await answer();
    expect(plane.current.asked).toHaveLength(3);
    await answer(); // the last two responses and the prompt, drawn above the record; nothing older
    expect(drawn().some((id) => id.startsWith('user:'))).toBe(true);
    expect(plane.current.asked).toHaveLength(3);
  });
});

describe('the drawn row count, which a page is measured against', () => {
  it('in the report, follows a working record opened and closed again', async () => {
    const plane = new FakePlane('proj');
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: `s-${Math.random()}`, agentId: null }, store: useTranscriptStore });
    controller.open();
    const unmount = mount(controller, useTranscriptStore);
    const lane = useTranscriptStore.subscribe((s) => s.entries[controller.key] && s.entries[controller.key].state.ui.ownerLane !== true && s.setOwnerLane(controller.key, true));
    try {
      const script = scriptOf(markedTurn, null);
      await act(async () => {
        plane.snapshot(script, script.length);
        await settle();
        await settle();
      });
      const count = renderHook(() => useDrawnRowCount(controller.key));
      const drawn = () => drawnRows(controller.key, []);
      const record = drawn().find((row) => row.id.startsWith('owner-record:'))!;
      const folded = count.result.current;
      expect(folded).toBe(drawn().length);
      act(() => useTranscriptStore.getState().toggleReportRecord(controller.key, record.turnId!));
      expect(drawn().length).toBeGreaterThan(folded); // the record's work drawn
      expect(count.result.current).toBe(drawn().length);
      act(() => useTranscriptStore.getState().toggleReportRecord(controller.key, record.turnId!));
      expect(count.result.current).toBe(folded);
    } finally {
      lane();
      unmount();
      controller.close();
      useTranscriptStore.getState().drop(controller.key);
    }
  });
});
