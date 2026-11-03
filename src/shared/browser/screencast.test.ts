// The feed seam's validators (P5 O17 M6; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §G, "validation
// at this boundary"): every bound a viewer's input meets before it reaches an engine.
import { describe, expect, it } from 'vitest';
import { BROWSER_LIMITS, BrowserSeqSchema, readBrowserInput } from './screencast';

const VIEWPORT = { width: 1280, height: 800 };
const pointer = { kind: 'pointer', type: 'down', x: 640, y: 400, button: 'left', buttons: 1, clickCount: 1, modifiers: [] };
const wheel = { kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY: 120, modifiers: [] };
const key = { kind: 'key', type: 'down', key: 'Enter', code: 'Enter', repeat: false, modifiers: ['Meta'] };
const refused = (event: unknown, viewport: typeof VIEWPORT | null = VIEWPORT) => 'refusal' in readBrowserInput(event, viewport);

describe('a viewer’s input at the feed seam (§G)', () => {
  it('takes each kind within its bounds, and reads it as a BrowserInput', () => {
    expect(readBrowserInput(pointer, VIEWPORT)).toEqual({ input: pointer });
    for (const event of [wheel, key, { kind: 'text', text: 'héllo' }, { kind: 'blur' }]) expect(refused(event), JSON.stringify(event)).toBe(false);
    expect(refused({ ...pointer, x: 1280, y: 800 }), 'the viewport’s far edge').toBe(false);
  });

  it('refuses coordinates that are not finite or fall outside the viewport, and a point before any frame', () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1281]) expect(refused({ ...pointer, x }), String(x)).toBe(true);
    expect(refused({ ...wheel, y: 801 })).toBe(true);
    expect(refused({ ...wheel, deltaY: Number.NEGATIVE_INFINITY })).toBe(true);
    expect(refused({ ...wheel, deltaY: 10_001 }), 'a bounded delta').toBe(true);
    expect(refused(pointer, null), 'no frame seen: no point to name').toBe(true);
    expect(refused(key, null), 'a key names no point').toBe(false);
  });

  it('takes modifiers from Alt, Control, Meta and Shift alone, and bounds buttons, click counts, keys and text', () => {
    expect(refused({ ...key, modifiers: ['Alt', 'Control', 'Meta', 'Shift'] })).toBe(false);
    expect(refused({ ...key, modifiers: ['Hyper'] })).toBe(true);
    expect(refused({ ...key, modifiers: ['shift'] }), 'the names as written').toBe(true);
    expect(refused({ ...pointer, buttons: 8 })).toBe(true);
    expect(refused({ ...pointer, clickCount: 4 })).toBe(true);
    expect(refused({ ...pointer, button: 'back' })).toBe(true);
    expect(refused({ ...key, key: '' })).toBe(true);
    expect(refused({ ...key, key: 'k'.repeat(65) })).toBe(true);
    expect(refused({ kind: 'text', text: 'a'.repeat(BROWSER_LIMITS.textBytes) })).toBe(false);
    expect(refused({ kind: 'text', text: 'a'.repeat(BROWSER_LIMITS.textBytes + 1) })).toBe(true);
    expect(refused({ kind: 'text', text: '가'.repeat(BROWSER_LIMITS.textBytes / 3 + 1) }), 'bytes, not characters').toBe(true);
    expect(refused({ kind: 'text', text: '' })).toBe(true);
    expect(refused({ ...pointer, extra: 1 }), 'nothing beyond the shape').toBe(true);
    expect(refused({ kind: 'focus' })).toBe(true);
  });

  it('counts sequences as positive safe integers', () => {
    for (const seq of [1, Number.MAX_SAFE_INTEGER]) expect(BrowserSeqSchema.safeParse(seq).success, String(seq)).toBe(true);
    for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) expect(BrowserSeqSchema.safeParse(seq).success, String(seq)).toBe(false);
  });
});
