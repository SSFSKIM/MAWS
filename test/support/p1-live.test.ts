// The pure parts of E11's app-level live sittings (docs/doperpowers/plans/2026-10-06-e11-finish.md, Task 6.1;
// e2e/support/p1-live.ts and e2e/support/oopif-page.ts): the caps, the A-15 log line, the screenshot's dominant colour,
// the site of a URL, the init plugin list, and the OOPIF page. Spawns no engine and reads no owner file.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { a15Line, budgetOf, budgetRefusal, capUsd, DEFAULT_CAP_USD, dominantColour, initPluginsOf, liveOutDir, siteOf, SITTING_CAP_USD, spentBySitting, type Charge } from '../../e2e/support/p1-live';
import { startOopifPage } from '../../e2e/support/oopif-page';

const row = (seq: number, direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq, direction, at: '', frame });

describe('the caps', () => {
  it('holds each sitting to its own cap (Design §5) and the run to MAWS_P1_LIVE_MAX_USD, their sum when unset', () => {
    expect(SITTING_CAP_USD).toEqual({ s3: 0.5, s4: 0.4, s6: 0.3 });
    expect(DEFAULT_CAP_USD).toBeCloseTo(0.5 + 0.4 + 0.3, 10);
    expect(capUsd({})).toBe(1.2);
    expect(capUsd({ MAWS_P1_LIVE_MAX_USD: '0.5' })).toBe(0.5);
    expect(() => capUsd({ MAWS_P1_LIVE_MAX_USD: 'lots' })).toThrow(/MAWS_P1_LIVE_MAX_USD/);
    expect(() => capUsd({ MAWS_P1_LIVE_MAX_USD: '0' })).toThrow(/MAWS_P1_LIVE_MAX_USD/);
  });

  it('adds each case’s receipts and charges to its sitting (A-47 is S4’s), a later charge under a key replacing the earlier', () => {
    const charges: Charge[] = [
      { key: 'fork', case: 's3', label: 'the side thread, reserved', usd: 0.08 },
      { key: 'btw', case: 's3', label: 'the side question', usd: 0.05 },
      { key: 'fork', case: 's3', label: 'the side thread, settled', usd: 0.01 },
    ];
    const spent = spentBySitting({ s3: 0.1, 's4-browser': 0.05, a47: 0.02, 's4-oopif': 0, s6: 0 }, charges);
    expect(spent.sittings.s3).toBeCloseTo(0.16, 10);
    expect(spent.sittings.s4).toBeCloseTo(0.07, 10);
    expect(spent.sittings.s6).toBe(0);
    expect(spent.run).toBeCloseTo(0.23, 10);
  });

  it('allocates the smaller of the sitting’s and the run’s remainders', () => {
    const spent = { sittings: { s3: 0.16, s4: 0.07, s6: 0 }, run: 0.23 };
    expect(budgetOf('s3', spent, 1.2)).toEqual({ sitting: 's3', sittingLeft: 0.34, runLeft: 0.97, usd: 0.34 });
    expect(budgetOf('s3', spent, 0.3)).toEqual({ sitting: 's3', sittingLeft: 0.34, runLeft: 0.07, usd: 0.07 });
    expect(budgetOf('s6', { sittings: { s3: 0, s4: 0, s6: 0.35 }, run: 0.35 }, 1.2).usd).toBe(0);
  });

  it('refuses a case once either remainder is spent, or when what is left does not cover what the case reserves', () => {
    const budget = (sittingLeft: number, runLeft: number) => ({ sitting: 's3' as const, sittingLeft, runLeft, usd: Math.max(0, Math.min(sittingLeft, runLeft)) });
    expect(budgetRefusal(budget(0.34, 0.97))).toBeNull();
    expect(budgetRefusal(budget(0, 0.97))).toBe('not run (budget): S3 has spent its US$0.50 cap');
    expect(budgetRefusal(budget(-0.01, 0.97))).toBe('not run (budget): S3 has spent its US$0.50 cap');
    expect(budgetRefusal(budget(0.34, 0), 1.2)).toBe('not run (budget): the run has spent its US$1.20 cap');
    expect(budgetRefusal(budget(0.34, 0.97), 1.2, { usd: 0.08, for: 'the side thread' })).toBeNull();
    expect(budgetRefusal(budget(0.07, 0.97), 1.2, { usd: 0.08, for: 'the side thread' })).toBe('not run (budget): US$0.0700 left (S3 US$0.0700, the run US$0.9700) does not cover the US$0.0800 for the side thread');
  });
});

describe('where the logs go', () => {
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
