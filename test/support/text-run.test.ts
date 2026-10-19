// P3-C M9 fix wave 2 (finding 4; Decision Log 23): the LibreOffice compare's text matcher. A text box's whole text is
// present when a run of the converted PDF's words reads it in order, word for word; only a word that is all symbols (a
// glyph a fallback face draws, which the PDF may emit out of place) may sit elsewhere in its run.
import { describe, expect, it } from 'vitest';
import { wordsAlong, wordsOfBox, type Word } from '../../e2e/support/text-run';

const word = (text: string, x: number, y = 100): Word => ({ text, x0: x, y0: y, x1: x + 10 * text.length, y1: y + 30 });
const INK: [number, number, number, number] = [100, 100, 600, 130];

describe('the text matcher', () => {
  it('reads a box’s words in order', () => {
    expect(wordsOfBox([word('North', 100), word('South', 200)], INK, 'North South')).toMatchObject({ joined: 'NorthSouth', box: [100, 100, 250, 130] });
  });

  it('refuses the same words swapped', () => {
    expect(wordsOfBox([word('South', 100), word('North', 200)], INK, 'North South')).toBeNull();
  });

  it('lets a symbol-only word sit elsewhere in its run, and passes over a list’s markers', () => {
    expect(wordsOfBox([word('Not', 100), word('started', 150), word('✕', 250)], INK, '✕ Not started')).not.toBeNull();
    expect(wordsOfBox([word('•', 90), word('One', 100), word('•', 90, 140), word('Two', 100, 140)], INK, 'One Two')).not.toBeNull();
    // a symbol the text does not hold is no part of it
    expect(wordsOfBox([word('Not', 100), word('#', 140), word('started', 150)], INK, 'Not started')).toBeNull();
  });

  // a turned line: pdftotext breaks it into pieces and writes them in no reading order; read along the line's angle
  it('reads a turned box’s pieces along its angle, in order, and refuses them swapped', () => {
    const along = (pieces: string[], deg: number) => {
      const t = (deg * Math.PI) / 180;
      let at = 0;
      const placed = pieces.map((text) => {
        const w = word(text, 300 + Math.cos(t) * at, 300 + Math.sin(t) * at);
        at += 12 * text.length;
        return w;
      });
      return placed.reverse(); // the stream's order: back to front
    };
    const box: [number, number, number, number] = [280, 200, 600, 360];
    expect(wordsAlong(along(['A', 'turn', 'e', 'd', 'li', 'ne'], -12), box, 'A turned line', -12)).toMatchObject({ joined: 'Aturnedline' });
    expect(wordsAlong(along(['South', 'North'], -12), box, 'North South', -12)).toBeNull();
  });

  // P3-F (L210): the exception is the symbol classes alone; punctuation is read in its place with the letters and digits,
  // so a box whose comma, colon or stop LibreOffice moved or lost is not read as whole
  it('reads punctuation in its place, and lets only a symbol sit elsewhere in its run', () => {
    expect(wordsOfBox([word('North', 100), word('South', 200), word(',', 300)], INK, 'North, South')).toBeNull();
    expect(wordsOfBox([word('Done', 100), word('yes:', 200)], INK, 'Done: yes')).toBeNull();
    expect(wordsOfBox([word('Done:', 100), word('yes', 200)], INK, 'Done: yes')).toMatchObject({ joined: 'Done:yes' });
    expect(wordsOfBox([word('Q3', 100), word('Q4', 150), word('→', 200)], INK, 'Q3 → Q4')).not.toBeNull();
    expect(wordsOfBox([word('2.38', 100), word('g', 200), word('÷', 250), word('28.97', 300)], INK, '2.38 g ÷ 28.97')).not.toBeNull();
    const turned = (pieces: string[]) => pieces.map((text, i) => word(text, 300 + 60 * i, 300)).reverse();
    expect(wordsAlong(turned(['North', 'South', ',']), [280, 200, 600, 360], 'North, South', 0)).toBeNull();
    expect(wordsAlong(turned(['North,', 'South']), [280, 200, 600, 360], 'North, South', 0)).toMatchObject({ joined: 'North,South' });
  });

  it('of several runs that read the text, takes the one nearest the app’s text', () => {
    const found = wordsOfBox([word('Total', 900, 500), word('Total', 110)], INK, 'Total');
    expect(found!.box[0]).toBe(110);
  });
});
