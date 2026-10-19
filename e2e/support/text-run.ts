// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Decision Log 23): the LibreOffice compare's text
// matcher, over `pdftotext -bbox`'s words (e2e/presentations-export.spec.ts; its unit suite test/support/text-run.test.ts).
export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
// pdftotext writes a ligature as its one character; a text compares without its spaces
export const normalized = (text: string) => text.replace(/ﬀ/g, 'ff').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/\s+/g, '');
export type Extent = [number, number, number, number];
// a list's marker LibreOffice draws as a word of its own (a bullet, or a number and its stop)
const MARKER = /^(?:[•●◦▪‣∙·–-]|\d+[.)])$/;
// P3-F (L210): the symbol classes (Unicode's Sm, Sc, Sk and So: a `✕`, an arrow, a `÷`) are the glyphs a fallback face
// may draw out of place; everything else (letters, digits, punctuation) is read in its place
const ordered = (text: string) => text.replace(/\p{S}/gu, '');
const symbols = (text: string) => [...text.replace(/[^\p{S}]/gu, '')].sort().join('');

/**
 * The LibreOffice words of one text box. LibreOffice draws a box's text as one run of words in the page's stream,
 * wherever its lines broke, so the box's whole text is present when a contiguous run reads it word for word: its letters,
 * digits and punctuation in order, exactly. The one exception is confined to symbols (Unicode's symbol classes: a glyph a
 * fallback face draws, which the PDF may emit out of place, a `✕` after the words it precedes): they may sit anywhere in
 * their run, so long as the run's symbols are the text's. A list's markers are passed over. Of the runs that read it, the one starting
 * nearest the app's text; null when none does.
 */
export function wordsOfBox(page: Word[], ink: Extent, text: string): { joined: string; box: Extent } | null {
  const flat = normalized(text);
  const [wantOrdered, wantSymbols] = [ordered(flat), symbols(flat)];
  const room = (have: string, add: string) => {
    // the symbols of `have` plus `add`, still within the text's (as multisets)
    const left = [...wantSymbols];
    for (const ch of have + add) {
      const at = left.indexOf(ch);
      if (at < 0) return false;
      left.splice(at, 1);
    }
    return true;
  };
  let best: { joined: string; box: Extent; distance: number } | null = null;
  for (let i = 0; i < page.length; i++) {
    let [readOrdered, readSymbols, joined] = ['', '', ''];
    const run: Word[] = [];
    for (let j = i; j < page.length; j++) {
      const w = normalized(page[j]!.text);
      if (!w) continue;
      if (MARKER.test(w) && !flat.includes(w)) continue;
      const [wo, ws] = [ordered(w), symbols(w)];
      if (wo === '' ? !room(readSymbols, ws) : !wantOrdered.startsWith(readOrdered + wo) || !room(readSymbols, ws)) break;
      [readOrdered, readSymbols, joined] = [readOrdered + wo, readSymbols + ws, joined + w];
      run.push(page[j]!);
      if (readOrdered === wantOrdered && [...readSymbols].sort().join('') === wantSymbols) {
        const box: Extent = [Math.min(...run.map((r) => r.x0)), Math.min(...run.map((r) => r.y0)), Math.max(...run.map((r) => r.x1)), Math.max(...run.map((r) => r.y1))];
        const distance = Math.hypot(box[0] - ink[0], box[1] - ink[1]);
        if (!best || distance < best.distance) best = { joined, box, distance };
        break;
      }
    }
  }
  return best && { joined: best.joined, box: best.box };
}

/**
 * A turned text box's words (Decision Log 23 judges it by its centre): pdftotext breaks a turned line into pieces and
 * writes them in no reading order, so the pieces lying within the app's extent of it (grown by `slack` px), each part of
 * its text, are read along the line's angle (each line, then across it) and must give its letters, digits and punctuation
 * in order (P3-F, L210), its symbols anywhere; null when they do not.
 */
export function wordsAlong(page: Word[], ink: Extent, text: string, deg: number, slack = 24): { joined: string; box: Extent } | null {
  const flat = normalized(text);
  const t = (deg * Math.PI) / 180;
  const [ux, uy] = [Math.cos(t), Math.sin(t)];
  const hits = page.filter((w) => {
    const [cx, cy] = [(w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2];
    const piece = normalized(w.text);
    return piece !== '' && flat.includes(piece) && cx >= ink[0] - slack && cx <= ink[2] + slack && cy >= ink[1] - slack && cy <= ink[3] + slack;
  });
  if (!hits.length) return null;
  const along = (w: Word) => ((w.x0 + w.x1) / 2) * ux + ((w.y0 + w.y1) / 2) * uy;
  const across = (w: Word) => -((w.x0 + w.x1) / 2) * uy + ((w.y0 + w.y1) / 2) * ux;
  // lines: pieces within half a piece's height of the line's first, across the angle; each read along it
  const line = Math.max(8, Math.min(...hits.map((w) => w.y1 - w.y0)) / 2);
  const lines: Word[][] = [];
  for (const w of [...hits].sort((a, b) => across(a) - across(b))) {
    const last = lines[lines.length - 1];
    if (last && across(w) - across(last[0]!) <= line) last.push(w);
    else lines.push([w]);
  }
  const joined = lines.flatMap((l) => l.sort((a, b) => along(a) - along(b))).map((w) => normalized(w.text)).join('');
  if (ordered(joined) !== ordered(flat) || symbols(joined) !== symbols(flat)) return null;
  return { joined, box: [Math.min(...hits.map((w) => w.x0)), Math.min(...hits.map((w) => w.y0)), Math.max(...hits.map((w) => w.x1)), Math.max(...hits.map((w) => w.y1))] };
}
