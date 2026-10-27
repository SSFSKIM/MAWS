import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { clientOf, pageOf } from './clients';

// A fake page: Electron's WebContents is an EventEmitter with an id; `destroy` stands for the window closing.
let nextId = 100;
function fakePage() {
  const emitter = new EventEmitter() as EventEmitter & { id: number; destroyed: boolean; isDestroyed(): boolean };
  emitter.id = nextId++;
  emitter.destroyed = false;
  emitter.isDestroyed = () => emitter.destroyed;
  const contents = emitter as unknown as WebContents;
  return {
    contents,
    destroy() {
      emitter.destroyed = true;
      emitter.emit('destroyed');
    },
    crash: () => emitter.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 }),
    navigate: (details: { isMainFrame: boolean; isSameDocument: boolean }) => emitter.emit('did-start-navigation', details),
  };
}

describe('clientOf: one ClientRef per page instance', () => {
  it('answers the same ref across calls while the page instance lives, named by the page and its generation', () => {
    const page = fakePage();
    const client = clientOf(page.contents);
    expect(clientOf(page.contents)).toBe(client);
    expect(client.id).toBe(`page:${page.contents.id}.1`);
    expect(pageOf(client)).toBe(page.contents);
  });

  it('gives two pages two refs', () => {
    const a = fakePage();
    const b = fakePage();
    expect(clientOf(a.contents).id).not.toBe(clientOf(b.contents).id);
  });

  it.each([
    ['a destroy', (page: ReturnType<typeof fakePage>) => page.destroy()],
    ['a renderer crash', (page: ReturnType<typeof fakePage>) => page.crash()],
    ['a main-frame cross-document navigation', (page: ReturnType<typeof fakePage>) => page.navigate({ isMainFrame: true, isSameDocument: false })],
  ])('ends exactly once on %s, and pageOf answers null after', (_label, end) => {
    const page = fakePage();
    const client = clientOf(page.contents);
    const gone = vi.fn();
    client.onGone(gone);
    end(page);
    end(page);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(pageOf(client)).toBeNull();
  });

  it('runs a listener once even when a crash is followed by the destroy', () => {
    const page = fakePage();
    const gone = vi.fn();
    clientOf(page.contents).onGone(gone);
    page.crash();
    page.destroy();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('is not ended by a subframe navigation or a same-document navigation', () => {
    const page = fakePage();
    const client = clientOf(page.contents);
    const gone = vi.fn();
    client.onGone(gone);
    page.navigate({ isMainFrame: false, isSameDocument: false });
    page.navigate({ isMainFrame: true, isSameDocument: true });
    expect(gone).not.toHaveBeenCalled();
    expect(clientOf(page.contents)).toBe(client);
    expect(pageOf(client)).toBe(page.contents);
  });

  it('mints a fresh ref, the next generation, for the document after a navigation', () => {
    const page = fakePage();
    const first = clientOf(page.contents);
    page.navigate({ isMainFrame: true, isSameDocument: false });
    const second = clientOf(page.contents);
    expect(second).not.toBe(first);
    expect(second.id).toBe(`page:${page.contents.id}.2`);
    expect(pageOf(second)).toBe(page.contents);
    const gone = vi.fn();
    second.onGone(gone);
    page.destroy();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('runs a listener added after the end at once, and only once', () => {
    const page = fakePage();
    const client = clientOf(page.contents);
    page.destroy();
    const late = vi.fn();
    client.onGone(late);
    expect(late).toHaveBeenCalledTimes(1);
    page.destroy();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('answers a destroyed page with a ref that is already gone', () => {
    const page = fakePage();
    page.destroy();
    const client = clientOf(page.contents);
    const gone = vi.fn();
    client.onGone(gone);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(pageOf(client)).toBeNull();
  });

  it('does not run a listener that unsubscribed', () => {
    const page = fakePage();
    const gone = vi.fn();
    const off = clientOf(page.contents).onGone(gone);
    off();
    page.destroy();
    expect(gone).not.toHaveBeenCalled();
  });

  it('runs every listener when one of them throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = fakePage();
    const client = clientOf(page.contents);
    const after = vi.fn();
    client.onGone(() => { throw new Error('listener fault'); });
    client.onGone(after);
    page.destroy();
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('answers null from pageOf for a ref clientOf did not mint', () => {
    expect(pageOf({ id: 'conn-1/page:1.1' as never, onGone: () => () => {} })).toBeNull();
  });
});
