// P3-E2 M1 spike: the in-house Kit held against d3 as the reference over many generated domains, so the comparison
// knows where the small arithmetic matches the library and where it does not.
import { describe, expect, it } from 'vitest';
import { d3Kit } from '../src/kit-d3';
import { houseKit } from '../src/kit-house';
import { SHAPES, type Point } from '../src/kit';

let seed = 7;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const close = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= Math.max(1e-9, Math.abs(v) * 1e-12));

describe('house against d3', () => {
  it('nice linear domains and ticks agree over 2,000 generated domains (magnitudes 1e-6 to 1e9, signs mixed)', () => {
    const misses: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const scale = 10 ** Math.floor(rand() * 15 - 6);
      const a = (rand() - 0.5) * scale;
      const b = a + rand() * scale;
      const count = 2 + Math.floor(rand() * 9);
      const d = d3Kit.linear([a, b], [300, 0], count, true);
      const h = houseKit.linear([a, b], [300, 0], count, true);
      if (!close(d.domain, h.domain) || !close(d.ticks, h.ticks)) misses.push(`[${a}, ${b}] ×${count}: d3 ${d.ticks.join(' ')} | house ${h.ticks.join(' ')}`);
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it('time ticks agree on the spans dashboards show (an hour to two centuries)', () => {
    const spans = [3600e3, 6 * 3600e3, 86400e3, 7 * 86400e3, 31 * 86400e3, 92 * 86400e3, 365 * 86400e3, 3 * 365 * 86400e3, 12 * 365 * 86400e3, 60 * 365 * 86400e3, 147 * 365 * 86400e3, 220 * 365 * 86400e3];
    const rows: string[] = [];
    let agree = 0;
    for (const span of spans)
      for (let i = 0; i < 20; i += 1) {
        const start = Date.UTC(1900, 0, 1) + Math.floor(rand() * 120 * 365) * 86400e3 + Math.floor(rand() * 86400e3);
        const d = d3Kit.time([start, start + span], [0, 600], 6).ticks;
        const h = houseKit.time([start, start + span], [0, 600], 6).ticks;
        if (close(d, h)) agree += 1;
        else if (i === 0) rows.push(`${Math.round(span / 86400e3)} d: d3 ${d.length} ticks, house ${h.length}`);
      }
    console.log(`time ticks: ${agree} of ${spans.length * 20} agree; first differing per span: ${rows.join('; ') || 'none'}`);
    expect(agree).toBe(spans.length * 20);
  });

  it('bands, pies, lines and markers agree', () => {
    for (const n of [1, 2, 3, 8, 50]) {
      const d = d3Kit.band(n, [40, 660], 0.2, 0.1);
      const h = houseKit.band(n, [40, 660], 0.2, 0.1);
      expect(close(d.starts, h.starts) && Math.abs(d.bandwidth - h.bandwidth) < 1e-9).toBe(true);
    }
    const values = [52, 168, 124, 0, 3];
    const dp = d3Kit.pie(values);
    const hp = houseKit.pie(values);
    expect(close(dp.flatMap((s) => [s.start, s.end]), hp.flatMap((s) => [s.start, s.end]))).toBe(true);
    const pts: Point[] = [[0, 1], [1.234567, 2.5], [2, null], [3, 4], [4, null], [5, 6], [6, 7]];
    expect(houseKit.line(pts)).toBe(d3Kit.line(pts));
    for (const shape of SHAPES) expect(houseKit.symbols(shape, 64, [[10, 20], [30.5, 40.25]]), shape).toBe(d3Kit.symbols(shape, 64, [[10, 20], [30.5, 40.25]]));
  });
});
