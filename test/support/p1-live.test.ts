// The pure parts of E11's app-level live sittings (docs/doperpowers/plans/2026-10-06-e11-finish.md, Task 6.1;
// e2e/support/p1-live.ts and e2e/support/oopif-page.ts): the cap, the A-15 log line, the screenshot's dominant colour,
// the site of a URL, the init plugin list, and the OOPIF page. Spawns no engine and reads no owner file.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { a15Line, budgetRefusal, capUsd, dominantColour, initPluginsOf, liveOutDir, remainingUsd, siteOf } from '../../e2e/support/p1-live';
import { startOopifPage } from '../../e2e/support/oopif-page';

describe('the cap', () => {
  it('reads MAWS_P1_LIVE_MAX_USD, US$1.20 when unset, and refuses a value that is not a positive amount', () => {
    expect(capUsd({})).toBe(1.2);
    expect(capUsd({ MAWS_P1_LIVE_MAX_USD: '0.5' })).toBe(0.5);
    expect(() => capUsd({ MAWS_P1_LIVE_MAX_USD: 'lots' })).toThrow(/MAWS_P1_LIVE_MAX_USD/);
    expect(() => capUsd({ MAWS_P1_LIVE_MAX_USD: '0' })).toThrow(/MAWS_P1_LIVE_MAX_USD/);
  });

  it('gives each session the remainder, and refuses a case once the run has spent the cap', () => {
    expect(remainingUsd(1.2, 0.35)).toBe(0.85);
    expect(remainingUsd(1.2, 1.5)).toBe(0);
    expect(budgetRefusal(1.2, 0.3)).toBeNull();
    expect(budgetRefusal(1.2, 1.2)).toBe('not run (budget): US$1.2000 spent of the US$1.20 cap');
  });

  it('writes its logs where MAWS_P1_LIVE_OUT names, a directory under /tmp otherwise', () => {
    expect(liveOutDir({})).toBe('/tmp/maws-e11-p1-live');
    expect(liveOutDir({ MAWS_P1_LIVE_OUT: '/tmp/elsewhere' })).toBe('/tmp/elsewhere');
  });
});

describe('the A-15 log line', () => {
  // the comparison itself is the shared one's (test/support/owner-file.test.ts)
  const first = { keys: ['/private/tmp/cua-accept'], digest: 'a'.repeat(40) };
  const ours = ['/private/tmp/maws-e11-p1live-r1'];

  it('names the reading’s count, its digest and the delta against the first', () => {
    expect(a15Line('before the case', first, first, ours)).toBe(`A-15 before the case: 1 keys, sha1 ${'a'.repeat(40)} (identical)`);
    const other = { keys: ['/private/tmp/cua-accept', '/tmp/other-session'], digest: 'b'.repeat(40) };
    expect(a15Line('after s3', first, other, ours)).toBe(`A-15 after s3: 2 keys, sha1 ${'b'.repeat(40)} (added ["/tmp/other-session"], removed []; none the sitting’s own (recorded, not a breach))`);
  });
});

// A PNG of `width` × `height`, every row written with `filter` (0 none, 1 sub, 2 up, 3 average, 4 Paeth), from
// `pixel(x, y)`: Electron's encoder picks filters per row, so the decoder must undo each.
function png(width: number, height: number, channels: 3 | 4, filter: number, pixel: (x: number, y: number) => number[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  const stride = width * channels;
  const raw = Array.from({ length: height }, (_, y) => Buffer.from(Array.from({ length: width }, (_, x) => pixel(x, y).slice(0, channels)).flat()));
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const lines = raw.map((line, y) => {
    const up = y > 0 ? raw[y - 1]! : Buffer.alloc(stride);
    const out = Buffer.alloc(stride + 1);
    out[0] = filter;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = up[i]!;
      const c = i >= channels ? up[i - channels]! : 0;
      const predicted = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]!;
      out[i + 1] = (line[i]! - predicted) & 0xff;
    }
    return out;
  });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(lines))), chunk('IEND', Buffer.alloc(0))]);
}

describe('the screenshot’s dominant colour', () => {
  // a page whose background is one colour, with a darker heading band across its top fifth
  const page = (background: number[]) => (_x: number, y: number) => (y < 4 ? [20, 20, 20, 255] : [...background, 255]);

  it.each([0, 1, 2, 3, 4])('reads the background through filter %i, RGBA and RGB', (filter) => {
    for (const channels of [3, 4] as const) {
      const { rgb, share } = dominantColour(png(32, 20, channels, filter, page([204, 51, 17])));
      expect(rgb).toEqual([204, 51, 17]);
      expect(share).toBeCloseTo(0.8, 5);
    }
  });

  it('refuses what is not an 8-bit non-interlaced PNG', () => {
    expect(() => dominantColour(Buffer.from('not a png'))).toThrow(/PNG/);
  });
});

describe('the site of a URL', () => {
  it('is the registrable domain, or the host itself for an address or a single-label name', () => {
    expect(siteOf('http://127.0.0.1:17393/oopif.html')).toBe('http://127.0.0.1');
    expect(siteOf('http://localhost:17393/field.html')).toBe('http://localhost');
    expect(siteOf('https://developer.mozilla.org/en-US/')).toBe('https://mozilla.org');
    expect(siteOf('https://live.mdnplay.dev/x')).toBe('https://mdnplay.dev');
    expect(siteOf('https://a.example.com/')).toBe(siteOf('https://b.example.com/'));
    expect(siteOf('http://[::1]:17393/')).toBe('http://[::1]');
  });
});

describe('the init plugin list', () => {
  const row = (seq: number, direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq, direction, at: '', frame });
  it('is the first engine system/init frame’s, with each plugin’s path, or null before one', () => {
    const plugins = [{ name: 'mine', source: 'mine@market', path: '/tmp/x' }];
    expect(initPluginsOf([row(1, 'out', { type: 'user' })])).toBeNull();
    expect(initPluginsOf([row(1, 'in', { type: 'system', subtype: 'init', plugins }), row(2, 'in', { type: 'system', subtype: 'init', plugins: [] })])).toEqual(plugins);
    expect(initPluginsOf([row(1, 'in', { type: 'system', subtype: 'init' })])).toEqual([]);
  });
});

describe('the OOPIF page', () => {
  it('serves a page on 127.0.0.1 framing a text field from localhost, a second site', async () => {
    const served = await startOopifPage(0);
    try {
      expect(siteOf(served.page)).not.toBe(siteOf(served.frame));
      const page = await (await fetch(served.page)).text();
      expect(page).toContain(`<iframe title="Second site" src="${served.frame}"`);
      const frame = await (await fetch(served.frame.replace('localhost', '127.0.0.1'))).text();
      expect(frame).toContain('<label>Note <input name="note" autocomplete="off"></label>');
      expect((await fetch(served.page.replace('/oopif.html', '/nope'))).status).toBe(404);
    } finally {
      await served.close();
    }
  });
});
