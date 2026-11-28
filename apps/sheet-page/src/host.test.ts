// The page's SheetHost (§P; T17): what C3's components ask of a surface, answered through the page's own requests.
import { describe, expect, it, vi } from 'vitest';
import type { SheetLine } from '@shared/sheet/model';
import type { Api } from './api';
import { pageSheetHost } from './host';

const S = '5eed0000-0000-4000-8000-000000000019';

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    pair: vi.fn(),
    unpair: vi.fn(),
    read: vi.fn(),
    put: vi.fn(async (_session: string, lines: SheetLine[]) => ({ ok: true as const, results: lines.map((line) => ({ key: line.key, state: 'queued' as const })) })),
    body: vi.fn(async () => ({ kind: 'text' as const, text: 'captured' })),
    upload: vi.fn(async () => ({ ok: true as const, path: 'uploads/maws-0123.png' })),
    ...overrides,
  };
}

describe('the page’s host', () => {
  it('writes as the page, with keys of its own form, each new', () => {
    const host = pageSheetHost({ api: fakeApi() });
    expect(host.by).toBe('page');
    const keys = new Set(Array.from({ length: 50 }, () => host.newKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^page-[a-z2-7]{26}$/);
  });

  it('sends a Send’s lines once, through the page’s put', async () => {
    const api = fakeApi();
    const host = pageSheetHost({ api });
    const lines = [{ v: 1 as const, key: host.newKey(), kind: 'dismiss' as const, id: 'q1', by: 'page' as const }];
    expect(await host.send(S, lines)).toEqual({ ok: true, results: [{ key: lines[0]!.key, state: 'queued' }] });
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(S, lines);
  });

  it('refuses every write while the session’s model is not fresh, and asks nothing of the page’s put (B3)', async () => {
    const api = fakeApi();
    let fresh = false;
    const host = pageSheetHost({ api, writable: (session) => session === S && fresh });
    const dismiss = [{ v: 1 as const, key: host.newKey(), kind: 'dismiss' as const, id: 'q1', by: 'page' as const }];
    const takeBack = [{ v: 1 as const, key: host.newKey(), kind: 'retract' as const, target: 'page-x', by: 'page' as const }];
    expect(await host.send(S, dismiss)).toMatchObject({ ok: false, why: 'failed' });
    expect(await host.send(S, takeBack)).toMatchObject({ ok: false, why: 'failed' });
    expect(api.put).not.toHaveBeenCalled();
    fresh = true;
    expect(await host.send('5eed0000-0000-4000-8000-0000000000a2', dismiss)).toMatchObject({ ok: false, why: 'failed' }); // not the session on screen
    expect(api.put).not.toHaveBeenCalled();
    expect(await host.send(S, dismiss)).toMatchObject({ ok: true });
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('keeps a draft editable while the model is not fresh: a pasted image is still saved (B3)', async () => {
    const api = fakeApi();
    const host = pageSheetHost({ api, writable: () => false, downscale: async () => ({ mediaType: 'image/png', data: 'AQID' }) });
    expect(await host.saveImage!(S, { mediaType: 'image/png', bytes: new Uint8Array([1]) })).toEqual({ ok: true, path: 'uploads/maws-0123.png' });
  });

  it('opens a link in a new tab with no opener and no referrer, and offers no file of the machine', () => {
    const open = vi.fn();
    const host = pageSheetHost({ api: fakeApi(), open });
    host.openLink('https://example.com/a');
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
    expect(host.openFile).toBeUndefined();
  });

  it('asks a body of the page', async () => {
    const api = fakeApi();
    const host = pageSheetHost({ api });
    expect(await host.body(S, { ref: 'a'.repeat(64) })).toEqual({ kind: 'text', text: 'captured' });
    expect(api.body).toHaveBeenCalledWith(S, { ref: 'a'.repeat(64) });
  });

  it('scales a pasted image as the app does, then uploads the scaled bytes under their type', async () => {
    const api = fakeApi();
    const downscale = vi.fn(async () => ({ mediaType: 'image/jpeg', data: 'AQID', bytes: 3 }));
    const host = pageSheetHost({ api, downscale });
    expect(await host.saveImage!(S, { mediaType: 'image/webp', bytes: new Uint8Array([9, 9]) })).toEqual({ ok: true, path: 'uploads/maws-0123.png' });
    expect(downscale).toHaveBeenCalledWith(expect.any(Blob), 'image/webp');
    expect(api.upload).toHaveBeenCalledWith(S, { mediaType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) });
  });

  it('answers an image it could not scale as not saved, and uploads nothing', async () => {
    const api = fakeApi();
    const host = pageSheetHost({ api, downscale: async () => Promise.reject(new Error('not an image')) });
    expect(await host.saveImage!(S, { mediaType: 'image/png', bytes: new Uint8Array([1]) })).toEqual({ ok: false, why: expect.any(String) });
    expect(api.upload).not.toHaveBeenCalled();
  });
});
