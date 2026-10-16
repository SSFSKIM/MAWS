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
import { useOlderPages } from './older-pages';

const recorded = readRecording().session;
// The recording's prompt, nine of its attachments (which draw nothing), and a second prompt after them.
const prompt = recorded[0];
const attachments = Array.from({ length: 9 }, (_, i) => ({ ...recorded.filter((row) => row.type === 'attachment')[i % 3], uuid: `attachment-${i}` }));
const second = { ...prompt, uuid: 'second-prompt', message: { role: 'user', content: 'And one more thing.' } };

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

  function open(rows: JsonObject[], limit: number, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const plane = new FakePlane('proj');
    const controller = new DeskTranscript({ plane, project: 'proj', target: { machine: 'mini', session: `s-${Math.random()}`, agentId: null }, store: useTranscriptStore });
    controller.open();
    const unmount = mount(controller, useTranscriptStore);
    const list = scroller(geometry);
    renderHook(() => useOlderPages(controller, list, useStore(controller.state)));
    opened.push(() => (unmount(), controller.close(), useTranscriptStore.getState().drop(controller.key)));
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
});
