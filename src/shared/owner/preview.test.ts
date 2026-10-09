// The one compact-summary preview (E11 F2b, plan 2.6): owner-aware, chosen before truncation.
import { describe, expect, it } from 'vitest';
import { previewLine } from './preview';

describe('previewLine', () => {
  it('a plain answer is its first non-blank line, ANSI stripped and trimmed, capped', () => {
    expect(previewLine('\n\n  Done: the tests pass.\nMore detail', 160)).toBe('Done: the tests pass.');
    expect(previewLine('\u001b[1;36mColoured\u001b[0m line', 160)).toBe('Coloured line');
    expect(previewLine('x'.repeat(300), 160)).toBe('x'.repeat(160));
    expect(previewLine('   \n  ', 160)).toBeNull();
  });

  it('a report whose first line is only a tag shows its body, not "<to-human>" (the owner’s Needs you card)', () => {
    expect(previewLine('<to-human>\nThe migration ran; three tables changed.\n</to-human>', 160)).toBe('The migration ran; three tables changed.');
  });

  it('prefers the question, then the essential text, then the to-human text, then the plain line', () => {
    const essential = 'Some preamble\n<to-human>\nReport body.\n<essential>Decisive: ship it.</essential>\n</to-human>';
    expect(previewLine(essential, 160)).toBe('Decisive: ship it.');
    const question = `${essential}\n<need-input>Which branch should I use?\n<choice recommended>main</choice>\n<choice>dev</choice></need-input>`;
    expect(previewLine(question, 160)).toBe('Which branch should I use?');
    expect(previewLine('Intro\n<to-human>Report body.</to-human>', 160)).toBe('Report body.');
    expect(previewLine('<insight>Just a note</insight>\nPlain words', 160)).toBe('Plain words');
  });

  it('a question with only its choices reads them', () => {
    expect(previewLine('<need-input><choice recommended>Alpha</choice><choice>Beta</choice></need-input>', 160)).toBe('Alpha · Beta');
  });

  it('chooses before the cap: an essential past the first 200 characters still leads', () => {
    const long = `<to-human>\n${'filler '.repeat(60)}\n<essential>The point.</essential>\n</to-human>`;
    expect(long.indexOf('<essential>')).toBeGreaterThan(200);
    expect(previewLine(long, 160)).toBe('The point.');
  });

  it('a mark cut off by an older 200-character cap leaves no tag in the preview', () => {
    expect(previewLine('<to-human>\n<essential>Decisive: the cache is stale', 160)).toBe('Decisive: the cache is stale');
    expect(previewLine('<to-human>', 160)).toBeNull();
  });

  it('other markup stays as written', () => {
    expect(previewLine('Use <div> here', 160)).toBe('Use <div> here');
  });
});
