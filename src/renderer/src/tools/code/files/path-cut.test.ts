// UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decision 8, M2 decision 9, Decision
// Log 6 notes 10 and 11 and Decision Log 8): a folder that does not fit is cut at its start, on the text, by measured
// widths; below two characters of room it is not drawn. A stand-in measure counts characters.
import { afterEach, describe, expect, it } from 'vitest';
import { folderFromEnd, measureIn, measureWith } from './path-cut';

const chars = (text: string) => text.length;

describe('folderFromEnd', () => {
  const FOLDER = 'harbor/src/gauges/calibration/';

  it('answers the whole folder when it fits', () => {
    expect(folderFromEnd(FOLDER, FOLDER.length, chars)).toBe(FOLDER);
    expect(folderFromEnd(FOLDER, 400, chars)).toBe(FOLDER);
  });

  it('cuts at the start, keeping the longest end that begins at a segment’s start', () => {
    expect(folderFromEnd(FOLDER, 20, chars)).toBe('…gauges/calibration/');
    expect(folderFromEnd(FOLDER, 23, chars)).toBe('…gauges/calibration/'); // `…src/gauges/calibration/` is 24
    expect(folderFromEnd(FOLDER, 13, chars)).toBe('…calibration/');
  });

  it('cuts inside the last segment when no segment fits, at a dot and at a slash, with no character reordered', () => {
    const versioned = 'harbor/calibration-v2.1/';
    expect(folderFromEnd(versioned, 6, chars)).toBe('…v2.1/');
    expect(folderFromEnd(versioned, 4, chars)).toBe('….1/');
    expect(folderFromEnd(versioned, 3, chars)).toBe('…1/');
    expect(folderFromEnd(versioned, 2, chars)).toBe('…/');
  });

  it('answers null below a room of two characters of the font', () => {
    expect(folderFromEnd(FOLDER, 1.9, chars)).toBeNull();
    expect(folderFromEnd(FOLDER, 0, chars)).toBeNull();
    expect(folderFromEnd(FOLDER, -40, chars)).toBeNull();
    expect(folderFromEnd('a/', 1, chars)).toBeNull(); // even a folder that is shorter than two characters' room needs it
  });

  it('measures in the font it is given: a wide font fits fewer characters', () => {
    const wide = (text: string) => text.length * 2;
    expect(folderFromEnd(FOLDER, 40, wide)).toBe('…gauges/calibration/');
    expect(folderFromEnd(FOLDER, 3, wide)).toBeNull();
  });
});

describe('measureIn: each distinct string measured once per font', () => {
  afterEach(() => measureWith(null));

  it('measures a string once in a font, again in another font, and answers the same width', () => {
    const calls: string[] = [];
    measureWith((font, text) => {
      calls.push(`${font}|${text}`);
      return text.length * (font === 'wide' ? 2 : 1);
    });
    const narrow = measureIn('narrow');
    const wide = measureIn('wide');
    expect([narrow('tides/'), narrow('tides/'), measureIn('narrow')('tides/'), wide('tides/'), wide('tides/')]).toEqual([6, 6, 6, 12, 12]);
    expect(calls).toEqual(['narrow|tides/', 'wide|tides/']);
  });
});
