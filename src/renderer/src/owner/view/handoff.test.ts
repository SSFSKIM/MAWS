// The record line's focus hand-off (UX wave U2b, M1 decision (j)): a press asks focus for the other line of its
// stretch in the transcript it was pressed in; the request is that transcript's alone, is taken once, and lapses at the
// next frame, so a line the list mounts later (scrolled to, or in a pane mounted after) is not handed focus.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handFocus, takesFocus } from './handoff';

let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
});
afterEach(() => vi.unstubAllGlobals());
const nextFrame = () => frames.splice(0).forEach((callback) => callback(0));

it('is taken by the line it names, in the transcript it was asked in, once', () => {
  handFocus('transcriptA', 'record-fold:open:s1');
  expect(takesFocus('transcriptB', 'record-fold:open:s1')).toBe(false);
  expect(takesFocus('transcriptA', 'record-fold:closed:s1')).toBe(false);
  expect(takesFocus('transcriptA', 'record-fold:open:s1')).toBe(true);
  expect(takesFocus('transcriptA', 'record-fold:open:s1')).toBe(false);
});

it('lapses at the next frame when its line was not drawn by then', () => {
  handFocus('transcriptA', 'record-fold:open:s1');
  nextFrame();
  expect(takesFocus('transcriptA', 'record-fold:open:s1')).toBe(false);
});

it('a later request is not lapsed by an earlier one’s frame', () => {
  handFocus('transcriptA', 'record-fold:open:s1');
  const earlier = frames.splice(0);
  handFocus('transcriptA', 'record-fold:open:s1');
  earlier.forEach((callback) => callback(0));
  expect(takesFocus('transcriptA', 'record-fold:open:s1')).toBe(true);
});

it('naming several lines, is taken by the first of them drawn, once', () => {
  handFocus('transcriptA', ['record-fold:closed:s1', 'record-fold:closed:s2']);
  expect(takesFocus('transcriptA', 'record-fold:closed:s3')).toBe(false);
  expect(takesFocus('transcriptA', 'record-fold:closed:s2')).toBe(true);
  expect(takesFocus('transcriptA', 'record-fold:closed:s1')).toBe(false);
});
