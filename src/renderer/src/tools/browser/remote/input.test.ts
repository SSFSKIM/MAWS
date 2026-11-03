// P5 O17 M10: what a person's pointer, wheel and keys on the agent's remote page become (§G's BrowserInput): the image
// fitted in its box with letterboxing, points mapped through the image into the tab's viewport and refused outside it
// (a drag in progress clamped to its edge, so its release always lands), keys a page needs (a press, its text once, its
// release), IME left to its commit, Escape releasing the keyboard and the app's own shortcuts never taken.
import { describe, expect, it } from 'vitest';
import { readBrowserInput } from '@shared/browser/screencast';
import { ClickCounter, fitImage, keyInputs, modifiersOf, pointAt, pointerInput, textInputs, wheelInput } from './input';

const BOX = { left: 10, top: 20, width: 400, height: 400 };
const FRAME = { width: 1280, height: 800 };
const VIEWPORT = { width: 1280, height: 800 };
const key = (over: Partial<KeyboardEventInit & { isComposing: boolean; keyCode: number }> = {}) => ({ key: 'a', code: 'KeyA', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, keyCode: 65, ...over });

describe('the remote page’s image and its points', () => {
  it('fits the frame in its box with letterboxing, centred', () => {
    expect(fitImage(BOX, FRAME)).toEqual({ left: 10, top: 95, width: 400, height: 250 }); // 1280×800 in 400×400: bars above and below
    expect(fitImage({ left: 0, top: 0, width: 800, height: 200 }, FRAME)).toEqual({ left: 240, top: 0, width: 320, height: 200 }); // bars at the sides
    expect(fitImage({ left: 0, top: 0, width: 0, height: 0 }, FRAME)).toBeNull();
  });

  it('maps a point through the image into the viewport, and refuses one in the letterbox', () => {
    const image = fitImage(BOX, FRAME)!;
    expect(pointAt(image, VIEWPORT, 10, 95, false)).toEqual({ x: 0, y: 0 });
    expect(pointAt(image, VIEWPORT, 210, 220, false)).toEqual({ x: 640, y: 400 });
    expect(pointAt(image, VIEWPORT, 410, 345, false)).toEqual({ x: 1280, y: 800 });
    expect(pointAt(image, VIEWPORT, 210, 60, false), 'the bar above the image').toBeNull();
    expect(pointAt(image, VIEWPORT, 420, 220, false), 'right of it').toBeNull();
  });

  it('clamps a point outside the image to its edge while a drag holds a button, so the release lands', () => {
    const image = fitImage(BOX, FRAME)!;
    expect(pointAt(image, VIEWPORT, 500, 60, true)).toEqual({ x: 1280, y: 0 });
    expect(pointAt(image, VIEWPORT, -5, 900, true)).toEqual({ x: 0, y: 800 });
  });

  it('scales to a viewport that differs from the JPEG’s pixels (a frame encoded smaller than the tab)', () => {
    const image = fitImage({ left: 0, top: 0, width: 640, height: 400 }, { width: 640, height: 400 })!;
    expect(pointAt(image, { width: 1280, height: 800 }, 320, 200, false)).toEqual({ x: 640, y: 400 });
  });
});

describe('pointer and wheel input', () => {
  it('names the button, the held buttons, the click count and the modifiers; every one passes §G’s validator', () => {
    const at = { x: 100, y: 50 };
    const down = pointerInput('down', { button: 0, buttons: 1, altKey: false, ctrlKey: false, metaKey: false, shiftKey: true }, at, 2);
    expect(down).toEqual({ kind: 'pointer', type: 'down', x: 100, y: 50, button: 'left', buttons: 1, clickCount: 2, modifiers: ['Shift'] });
    const right = pointerInput('up', { button: 2, buttons: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, at, 1);
    expect(right).toMatchObject({ button: 'right', buttons: 0, clickCount: 1 });
    const move = pointerInput('move', { button: -1, buttons: 4, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, at, 0);
    expect(move).toMatchObject({ type: 'move', button: 'left', buttons: 4, clickCount: 0 });
    expect(pointerInput('down', { button: 3, buttons: 8, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, at, 1), 'a back button: nothing').toBeNull();
    for (const input of [down, right, move]) expect(readBrowserInput(input, VIEWPORT)).toHaveProperty('input');
  });

  it('counts clicks as a person’s double and triple clicks, reset by time, distance or another button', () => {
    let now = 0;
    const clicks = new ClickCounter(() => now);
    expect(clicks.down('left', { x: 0, y: 0 })).toBe(1);
    now = 200;
    expect(clicks.down('left', { x: 2, y: 1 })).toBe(2);
    now = 350;
    expect(clicks.down('left', { x: 2, y: 1 })).toBe(3);
    now = 400;
    expect(clicks.down('left', { x: 2, y: 1 }), 'at most three').toBe(3);
    now = 1_200;
    expect(clicks.down('left', { x: 2, y: 1 }), 'too late').toBe(1);
    now = 1_300;
    expect(clicks.down('left', { x: 40, y: 1 }), 'too far').toBe(1);
    now = 1_400;
    expect(clicks.down('right', { x: 40, y: 1 }), 'another button').toBe(1);
    expect(clicks.up('right')).toBe(1);
  });

  it('turns a wheel’s lines and pages into pixels, in the DOM’s sense, bounded', () => {
    const at = { x: 10, y: 10 };
    const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(wheelInput({ deltaX: 0, deltaY: 120, deltaMode: 0, ...plain }, at, VIEWPORT)).toEqual({ kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY: 120, modifiers: [] });
    expect(wheelInput({ deltaX: 0, deltaY: 3, deltaMode: 1, ...plain }, at, VIEWPORT)).toMatchObject({ deltaY: 120 });
    expect(wheelInput({ deltaX: 0, deltaY: -1, deltaMode: 2, ...plain }, at, VIEWPORT)).toMatchObject({ deltaY: -800 });
    expect(wheelInput({ deltaX: 1e9, deltaY: 0, deltaMode: 0, ...plain }, at, VIEWPORT)).toMatchObject({ deltaX: 10_000 });
    expect(readBrowserInput(wheelInput({ deltaX: 0, deltaY: 120, deltaMode: 0, ...plain }, at, VIEWPORT), VIEWPORT)).toHaveProperty('input');
  });

  it('names the modifiers as §G’s four', () => {
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toEqual(['Alt', 'Control', 'Meta', 'Shift']);
  });
});

describe('keys', () => {
  it('a printable key is its press and its text once, then its release', () => {
    expect(keyInputs('down', key())).toEqual([
      { kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] },
      { kind: 'text', text: 'a' },
    ]);
    expect(keyInputs('up', key())).toEqual([{ kind: 'key', type: 'up', key: 'a', code: 'KeyA', repeat: false, modifiers: [] }]);
    expect(keyInputs('down', key({ key: 'A', shiftKey: true }))).toEqual([
      { kind: 'key', type: 'down', key: 'A', code: 'KeyA', repeat: false, modifiers: ['Shift'] },
      { kind: 'text', text: 'A' },
    ]);
  });

  it('a named key or a Control chord is its press alone (no text)', () => {
    expect(keyInputs('down', key({ key: 'Enter', code: 'Enter' }))).toEqual([{ kind: 'key', type: 'down', key: 'Enter', code: 'Enter', repeat: false, modifiers: [] }]);
    expect(keyInputs('down', key({ key: 'a', ctrlKey: true }))).toEqual([{ kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: ['Control'] }]);
    expect(keyInputs('down', key({ key: 'Backspace', code: 'Backspace', repeat: true }))).toEqual([{ kind: 'key', type: 'down', key: 'Backspace', code: 'Backspace', repeat: true, modifiers: [] }]);
  });

  it('leaves a key the IME is composing to its commit, so the text goes once', () => {
    expect(keyInputs('down', key({ key: 'Process', isComposing: true }))).toEqual([]);
    expect(keyInputs('down', key({ key: 'a', keyCode: 229 }))).toEqual([]);
  });

  it('Escape releases the keyboard; a Command chord is the app’s, never the page’s', () => {
    expect(keyInputs('down', key({ key: 'Escape', code: 'Escape' }))).toBe('release');
    expect(keyInputs('up', key({ key: 'Escape', code: 'Escape' }))).toEqual([]);
    expect(keyInputs('down', key({ key: 'k', metaKey: true }))).toBe('pass');
    expect(keyInputs('up', key({ key: 'k', metaKey: true }))).toBe('pass');
  });

  it('refuses keys §G cannot carry, so nothing invalid is sent', () => {
    expect(keyInputs('down', key({ key: '', code: '' }))).toEqual([]);
    expect(keyInputs('down', key({ key: 'x'.repeat(65) }))).toEqual([]);
    for (const input of keyInputs('down', key({ key: 'é', code: 'KeyE', altKey: true })) as unknown[]) expect(readBrowserInput(input, null)).toHaveProperty('input');
  });

  it('committed text (an IME’s, a paste) goes as text within §G’s bound, split in order, never a character cut', () => {
    expect(textInputs('')).toEqual([]);
    expect(textInputs('한국어')).toEqual([{ kind: 'text', text: '한국어' }]);
    const long = 'é'.repeat(9_000); // 18,000 bytes
    const parts = textInputs(long);
    expect(parts.map((part) => (part as { text: string }).text).join('')).toBe(long);
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(readBrowserInput(part, null)).toHaveProperty('input');
  });
});
