// UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C; C6, C7): the one image of every row
// and card. The tile is drawn at once; the directory's icon, as main answers it in image data, fills the same box; any
// other answer, a miss or a failed read keeps the tile; and a row drawn again inside the window's periods asks main
// nothing.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, PreloadBridge } from '@shared/ipc/schema';
import { TEST_MACHINE } from '../../../../../test/support/machine';
import { ItemImage } from './ItemImage';

const ICON = `https://api.anthropic.com/api/directory/plugin-icons/${'0a'.repeat(32)}/256.png`;
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';

let asked: string[];
let answer: (url: string) => Promise<{ ok: true; value: { dataUrl: string | null } } | { ok: false; error: { code: 'internal'; message: string } }>;

beforeEach(() => {
  asked = [];
  answer = async () => ({ ok: true, value: { dataUrl: PNG_DATA } });
  window.maws = {
    localMachine: TEST_MACHINE,
    invoke: (async (name: CommandName, input: unknown) => {
      if (name !== 'catalog.icon') throw new Error(`unexpected ${name}`);
      const { url } = input as { url: string };
      asked.push(url);
      return answer(url);
    }) as PreloadBridge['invoke'],
    on: (() => () => {}) as PreloadBridge['on'],
    pathForFile: () => '',
  } as PreloadBridge;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as { maws?: PreloadBridge }).maws;
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const draw = (client: QueryClient, iconUrl: string | null, size: 'row' | 'card' | 'head' | 'detail' = 'row') =>
  render(
    <QueryClientProvider client={client}>
      <ul>
        <li data-row>
          <ItemImage kind="plugin" seed="berth-notes" iconUrl={iconUrl} size={size} />
          <span>berth-notes</span>
        </li>
      </ul>
    </QueryClientProvider>,
  );
const image = () => document.querySelector<HTMLElement>('[data-item-image]')!;

describe('the item’s image', () => {
  it('without an icon is the tile at once: the letter on its colour, marked with its kind, and nothing asked', () => {
    draw(newClient(), null);
    expect(image().getAttribute('data-item-image')).toBe('tile');
    expect(image().getAttribute('data-item-kind')).toBe('plugin');
    expect(image().getAttribute('data-tile-colour')).toBe('4');
    expect(image().getAttribute('aria-hidden')).toBe('true');
    expect(image().className).toContain('bg-author-4/15');
    expect(image().className).toContain('text-author-4');
    expect(image().textContent).toBe('B');
    expect(asked).toEqual([]);
  });

  it('held open: the tile while main has not answered; then the icon in the same box, the row unchanged around it', async () => {
    let release!: () => void;
    answer = () => new Promise((resolve) => (release = () => resolve({ ok: true, value: { dataUrl: PNG_DATA } })));
    draw(newClient(), ICON);
    const box = image();
    const row = document.querySelector('[data-row]')!;
    const before = [...row.children];
    await waitFor(() => expect(asked).toEqual([ICON]));
    expect(box.getAttribute('data-item-image')).toBe('tile');
    expect(box.textContent).toBe('B');
    await act(async () => release());
    await waitFor(() => expect(box.getAttribute('data-item-image')).toBe('icon'));
    expect(image()).toBe(box); // the same element: the box the tile held
    expect(box.className).toContain('size-9');
    expect(box.querySelector('img')!.getAttribute('src')).toBe(PNG_DATA);
    expect(box.hasAttribute('data-tile-colour')).toBe(false);
    expect([...row.children]).toEqual(before);
  });

  it('keeps the tile when main answers no icon, when the read fails, and when the answer is not image data', async () => {
    for (const next of [
      async () => ({ ok: true as const, value: { dataUrl: null } }),
      async () => ({ ok: false as const, error: { code: 'internal' as const, message: 'no' } }),
      async () => ({ ok: true as const, value: { dataUrl: 'https://evil.example/x.png' } }),
    ]) {
      asked = [];
      answer = next;
      draw(newClient(), ICON);
      await waitFor(() => expect(asked).toEqual([ICON]));
      await act(async () => {});
      expect(image().getAttribute('data-item-image')).toBe('tile');
      expect(image().querySelector('img')).toBeNull();
      cleanup();
    }
  });

  it('an SVG icon is only an image of its data: its script and external reference neither run nor load', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.__itemIconRan=1"><script>window.__itemIconRan=1</script><image href="https://evil.example/x.png" width="10" height="10"/></svg>';
    const hostile = `data:image/svg+xml;base64,${btoa(svg)}`;
    answer = async () => ({ ok: true, value: { dataUrl: hostile } });
    const fetched = vi.spyOn(window, 'fetch');
    draw(newClient(), ICON, 'detail');
    await waitFor(() => expect(image().getAttribute('data-item-image')).toBe('icon'));
    expect(image().querySelector('img')!.getAttribute('src')).toBe(hostile);
    expect(image().querySelectorAll('svg, script, object, embed, iframe, image')).toHaveLength(0);
    expect((window as { __itemIconRan?: number }).__itemIconRan).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });

  it('a row drawn again inside the window’s periods asks main nothing: an icon for a day, a miss for five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const client = newClient();
    draw(client, ICON);
    await waitFor(() => expect(image().getAttribute('data-item-image')).toBe('icon'));
    cleanup();
    vi.setSystemTime(Date.now() + 23 * 60 * 60_000);
    draw(client, ICON);
    expect(image().getAttribute('data-item-image')).toBe('icon');
    await act(async () => {});
    expect(asked).toEqual([ICON]);
    cleanup();

    const MISS = ICON.replace('0a0a', '0b0b');
    answer = async () => ({ ok: true, value: { dataUrl: null } });
    draw(client, MISS);
    await waitFor(() => expect(asked).toEqual([ICON, MISS]));
    cleanup();
    vi.setSystemTime(Date.now() + 4 * 60_000);
    draw(client, MISS);
    await act(async () => {});
    expect(asked).toEqual([ICON, MISS]);
    cleanup();
    vi.setSystemTime(Date.now() + 2 * 60_000);
    draw(client, MISS);
    await waitFor(() => expect(asked).toEqual([ICON, MISS, MISS]));
  });

  it('keeps one box per size: a row’s, a card’s, a detail head’s, Discover’s detail’s', () => {
    const sizes = (['row', 'card', 'head', 'detail'] as const).map((size) => {
      draw(newClient(), null, size);
      const classes = image().className;
      cleanup();
      return classes.split(' ').find((c) => c.startsWith('size-'));
    });
    expect(sizes).toEqual(['size-9', 'size-10', 'size-11', 'size-14']);
  });
});
