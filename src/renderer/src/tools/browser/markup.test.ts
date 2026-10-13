// P3-G (§D4.1, §D4.3): the Browser tool's mark-up surface: the still from main, then the window's cover held until the
// session ends; the label `"<title>" — <url>`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { CapturedImage } from '@shared/markup/image';
import { browserMarkupLabel, browserMarkupSurface } from './markup';

const release = vi.fn();
const holdCover = vi.fn(() => release);
let acknowledge: () => void = () => {};
const coverAcknowledged = vi.fn(() => new Promise<void>((resolve) => (acknowledge = resolve)));
vi.mock('./covering', () => ({ holdCover: () => holdCover(), coverAcknowledged: () => coverAcknowledged() }));

const still: CapturedImage = { mediaType: 'image/png', data: 'c3RpbGw=', width: 800, height: 600 };
const client = (answer: { ok: true; value: { image: CapturedImage | null } } | { ok: false; error: { code: string; message: string } }) => {
  const invoke = vi.fn(async () => answer);
  return { client: { invoke } as unknown as MawsBridge, invoke };
};

afterEach(() => {
  vi.clearAllMocks();
});

// begin, with main acknowledging the cover as soon as it is asked
async function settled<T>(begun: Promise<T>): Promise<T> {
  await vi.waitFor(() => expect(coverAcknowledged).toHaveBeenCalled());
  acknowledge();
  return begun;
}

describe('browserMarkupSurface', () => {
  it('asks main for the tab’s still, then holds the cover until end', async () => {
    const { client: c, invoke } = client({ ok: true, value: { image: still } });
    const surface = browserMarkupSurface('b_0123456789ab', () => null, () => 'Page', c);
    expect(await settled(surface.begin())).toBe(still);
    expect(invoke).toHaveBeenCalledWith('browser.view.capture', { tabId: 'b_0123456789ab' });
    expect(holdCover).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    surface.end();
    surface.end();
    expect(release).toHaveBeenCalledTimes(1);
  });

  // the M4 review's ruling 4: the overlay draws only once main has the page hidden behind its picture
  it('answers the still only once main acknowledged the cover', async () => {
    const { client: c } = client({ ok: true, value: { image: still } });
    let answered = false;
    const begun = browserMarkupSurface('b_0123456789ab', () => null, () => 'Page', c)
      .begin()
      .then((image) => {
        answered = true;
        return image;
      });
    await vi.waitFor(() => expect(holdCover).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(coverAcknowledged).toHaveBeenCalledTimes(1);
    expect(answered).toBe(false);
    acknowledge();
    expect(await begun).toBe(still);
  });

  it('holds nothing when main answers no still or refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await browserMarkupSurface('b_0123456789ab', () => null, () => '', client({ ok: true, value: { image: null } }).client).begin()).toBeNull();
    expect(await browserMarkupSurface('b_0123456789ab', () => null, () => '', client({ ok: false, error: { code: 'invalid_input', message: 'not placed' } }).client).begin()).toBeNull();
    expect(holdCover).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[browser] the mark-up still was refused: not placed');
    warn.mockRestore();
  });

  it('labels the page by its quoted title and its URL, or the URL alone', () => {
    expect(browserMarkupLabel({ title: 'Page A', url: 'http://127.0.0.1/a.html' })).toBe('"Page A" — http://127.0.0.1/a.html');
    expect(browserMarkupLabel({ title: ' ', url: 'http://127.0.0.1/b.html' })).toBe('http://127.0.0.1/b.html');
  });
});
