// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M7; A17): the editor tints the passage an
// agent's answer reached once, for ANSWER_FLASH_MS, and nothing else: no other passage, no scroll, no caret, no undo
// step, and the display's own reading of which threads a passage draws is unchanged.
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_FLASH_MS, ANSWERED_CLASS, drawnThreads } from './plugins';
import { BASE_COVER, baseWorld, findPos, highlighted, type, type CommentWorld } from './test-support';

let open: CommentWorld[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const w of open) w.world.destroy();
  open = [];
});
const world = async () => {
  const w = await baseWorld();
  open.push(w);
  return w;
};

/** The text the flash tints in the rendered DOM, its spans joined by '|'. */
const tinted = (editor: Editor): string => [...editor.view.dom.querySelectorAll(`.${ANSWERED_CLASS}`)].map((el) => el.textContent).join('|');

describe('the answered passage (A17)', () => {
  it('tints that thread’s passage alone, then goes after ANSWER_FLASH_MS', async () => {
    const { A } = await world();
    const before = { selection: A.editor.state.selection.toJSON(), drawn: drawnThreads(A.editor.state), highlighted: highlighted(A.editor) };
    const seen: Transaction[] = [];
    A.editor.on('transaction', ({ transaction }) => void seen.push(transaction));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(A.editor.commands.flashThread('t2')).toBe(true);
    expect(tinted(A.editor).replaceAll('|', '')).toBe(BASE_COVER.t2);
    expect(A.editor.state.selection.toJSON(), 'the caret stays').toEqual(before.selection);
    expect(seen.every((tr) => !tr.scrolledIntoView && tr.getMeta('addToHistory') === false), 'no scroll, no undo step').toBe(true);
    expect(drawnThreads(A.editor.state)).toEqual(before.drawn);
    expect(highlighted(A.editor), 'the display reads no thread of the tint').toEqual(before.highlighted);

    vi.advanceTimersByTime(ANSWER_FLASH_MS - 1);
    expect(tinted(A.editor)).not.toBe('');
    vi.advanceTimersByTime(1);
    expect(tinted(A.editor)).toBe('');
  });

  it('follows an edit made while it shows, and draws nothing for a thread this editor does not show', async () => {
    const { A, B } = await world();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    A.editor.commands.flashThread('t3');
    vi.useRealTimers();
    type(A.editor, findPos(A.editor, 'Second'), 'A ');
    expect(tinted(A.editor).replaceAll('|', '')).toBe(BASE_COVER.t3);
    expect(tinted(B.editor), 'another replica’s editor is not asked').toBe('');

    expect(A.editor.commands.flashThread('no-such-thread')).toBe(true);
    expect(tinted(A.editor)).toBe('');
  });

  it('asked again for the same thread, shows for ANSWER_FLASH_MS from the second ask', async () => {
    const { A } = await world();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    A.editor.commands.flashThread('t1');
    vi.advanceTimersByTime(1_000);
    A.editor.commands.flashThread('t1');
    vi.advanceTimersByTime(ANSWER_FLASH_MS - 1);
    expect(tinted(A.editor).replaceAll('|', '')).toBe(BASE_COVER.t1);
    vi.advanceTimersByTime(1);
    expect(tinted(A.editor)).toBe('');
  });
});
