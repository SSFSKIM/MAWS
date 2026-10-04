// R2 review fixes: a scrolling site (the band, a pane) tells the engine its geometry before the person ever scrolls and
// whenever it changes size, sends a person's move as the offset before it and the rows it covered (the engine applies
// `by`, pass3/mods-surface-panes seq 59/60) then goes where the engine answers, and keeps a followed end in view through
// redraws until the person scrolls away. Layout is stubbed (happy-dom lays nothing out): rows of 18 px.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { invalidateSession, resetSurfaceRegistry } from './registry';
import { SurfaceSite } from './SurfaceSite';

const ID = 'app-r2' as AppSessionId;
const LINE = 18;
const BAND = { tree: { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', children: ['MODS_PROBE_BAND'] }] }, props: {}, rewritten: false, hooked: true };

// A ResizeObserver the test fires; `observed` holds what it watches.
const observers: (() => void)[] = [];
const observed = new Set<Element>();
class StubResizeObserver {
  constructor(private readonly callback: () => void) {
    observers.push(() => this.callback());
  }
  observe(target: Element) {
    observed.add(target);
  }
  disconnect() {
    observed.clear();
  }
}
const resize = () => act(() => observers.forEach((fire) => fire()));

let fake: FakeClient;
let drawn: unknown;
let scrollAnswer: (input: { offset: number; by: number }) => unknown;
beforeEach(() => {
  resetSurfaceRegistry();
  observers.splice(0);
  observed.clear();
  drawn = BAND;
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  scrollAnswer = (input) => ({ moved: true, offset: input.offset + input.by, deny: null, followEnd: false });
  fake = fakeClient({ 'session.ui.render': () => drawn, 'session.ui.scroll': (input: { offset: number; by: number }) => scrollAnswer(input) });
  act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...status(ID), uiSurface: { clientId: 'maws-main' } } }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The site's scroll container, laid out as `rows` of content in a 4-row window, its scrollTop a plain value.
async function mount() {
  const view = render(<SurfaceSite appSessionId={ID} component="AbovePrompt" instanceId="above-prompt" props={{}} client={fake.client} />);
  await act(async () => {});
  const container = view.container.querySelector<HTMLElement>('[data-surface-site="AbovePrompt"]')!;
  let top = 0;
  let rows = 20;
  Object.defineProperty(container, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => void (top = Math.max(0, Math.min(value, (rows - 4) * LINE))) });
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 4 * LINE });
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => rows * LINE });
  const person = (row: number) => act(() => {
    container.scrollTop = row * LINE;
    container.dispatchEvent(new Event('scroll'));
  });
  return { container, person, grow: (to: number) => void (rows = to), top: () => top / LINE };
}
const scrolls = () => fake.invoked('session.ui.scroll').map((i) => { const { offset, by, bodyRows, contentRows } = i as Record<string, number>; return { offset, by, bodyRows, contentRows }; });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 5)));
const push = (followEnd: boolean, offset: number) =>
  act(() =>
    fake.event('session.eventBatch', {
      appSessionId: ID,
      events: [{ id: `${ID}:L:9:0`, sessionId: 's', at: new Date().toISOString(), seq: 9, agentId: null, parentToolUseId: null, kind: 'plugin.scroll', component: 'AbovePrompt', instanceId: 'above-prompt', offset, followEnd } as SessionEvent],
    }),
  );
// The engine's reply to the oldest scroll report still out (a test that holds them).
const reply = (offset: number, followEnd = false) => act(() => fake.reply('session.ui.scroll', { moved: true, offset, deny: null, followEnd }));
const holdScrolls = () => void (fake = fakeClient({ 'session.ui.render': () => drawn }));

describe('a scrolling site’s window (R2 review fixes)', () => {
  it('reports its geometry with no move before any scroll, and again only when it changes size', async () => {
    const { grow } = await mount();
    resize();
    expect(scrolls()).toEqual([{ offset: 0, by: 0, bodyRows: 4, contentRows: 20 }]);
    resize(); // unchanged: nothing
    grow(30);
    resize();
    expect(scrolls()).toEqual([{ offset: 0, by: 0, bodyRows: 4, contentRows: 20 }, { offset: 0, by: 0, bodyRows: 4, contentRows: 30 }]);
  });

  it('sends a person’s move as the offset before it and the rows covered, then goes where the engine answers', async () => {
    const { container, person, top } = await mount();
    resize();
    await person(16);
    await settle();
    expect(scrolls().at(-1)).toEqual({ offset: 0, by: 16, bodyRows: 4, contentRows: 20 });
    scrollAnswer = () => ({ moved: true, offset: 12, deny: null, followEnd: false }); // a plugin's hook kept it a row higher
    await person(13);
    await settle();
    expect(scrolls().at(-1)).toEqual({ offset: 16, by: -3, bodyRows: 4, contentRows: 20 });
    expect(top()).toBe(12);
    act(() => void container.dispatchEvent(new Event('scroll'))); // the move MAWS made is not the person's
    expect(scrolls()).toHaveLength(3);
  });

  it('keeps a followed end in view as the content grows, until the person scrolls away from it', async () => {
    const { grow, person, top } = await mount();
    resize();
    push(true, 16);
    expect(top()).toBe(16);
    grow(30);
    resize();
    expect(top()).toBe(26); // still at the end
    await person(20);
    await settle();
    grow(40);
    resize();
    expect(top()).toBe(20); // the person left the end: no longer followed
    push(false, 3);
    expect(top()).toBe(3);
  });

  it('a reply the window moved past is dropped: a newer move’s reply decides, and a plugin’s follow stands', async () => {
    holdScrolls();
    const { grow, person, top } = await mount();
    resize();
    await reply(0); // the first layout report
    await person(16);
    await settle();
    await person(13);
    await settle();
    expect(scrolls().slice(1)).toEqual([{ offset: 0, by: 16, bodyRows: 4, contentRows: 20 }, { offset: 16, by: -3, bodyRows: 4, contentRows: 20 }]);
    await reply(16); // the first move's reply, after the second move
    expect(top()).toBe(13);
    await reply(12); // the latest move's reply: the engine kept the window a row higher
    expect(top()).toBe(12);
    await person(8);
    await settle();
    push(true, 0); // a plugin follows the end while the person's reply is out
    await reply(8, false);
    expect(top()).toBe(16);
    grow(30);
    resize();
    expect(top()).toBe(26); // still followed
  });

  it('watches a wrapper at the tree’s own height, kept through redraws, so a text-only tree’s growth is seen', async () => {
    drawn = { ...BAND, tree: { type: 'Text', children: ['one line'] } };
    const { container } = await mount();
    const wrapper = container.querySelector('[data-surface-content]')!;
    expect(wrapper.textContent).toBe('one line');
    expect([...observed]).toEqual([container, wrapper]);
    drawn = { ...BAND, tree: { type: 'Text', children: ['one line, then another and another'] } };
    await act(async () => invalidateSession(ID));
    expect(container.querySelector('[data-surface-content]')).toBe(wrapper);
    expect(wrapper.textContent).toBe('one line, then another and another');
    expect([...observed]).toEqual([container, wrapper]);
  });
});


it('applies a layout report answer and followed-end state, dropping a layout reply superseded by a push', async () => {
  holdScrolls();
  const { grow, top } = await mount();
  resize();
  await reply(16, true);
  expect(top()).toBe(16);
  grow(30);
  resize();
  expect(top()).toBe(26);
  push(false, 4);
  await reply(26, true);
  grow(40);
  resize();
  expect(top()).toBe(4);
});

it('reports keyed content-space row bounds on layout and subsequent render asks', async () => {
  drawn = { ...BAND, tree: { type: 'Button', props: { key: 'target', label: 'Target' }, press: { plugin: 'mod', handle: 1 } } };
  const { container } = await mount();
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
  const button = container.querySelector('button')!;
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 190, bottom: 226 } as DOMRect);
  container.scrollTop = 2 * LINE;
  resize();
  expect(fake.invoked('session.ui.scroll').at(-1)).toMatchObject({ keyed: [{ plugin: 'mod', key: 'target', top: 7, bottom: 9 }] });
  await act(async () => invalidateSession(ID));
  expect(fake.invoked('session.ui.render').at(-1)).toMatchObject({ contentRows: 20, keyed: [{ plugin: 'mod', key: 'target', top: 7, bottom: 9 }] });
});
