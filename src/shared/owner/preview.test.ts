// The one compact-summary preview (E11 F2b, plan 2.6): owner-aware, chosen before truncation.
import { describe, expect, it } from 'vitest';
import { markFreeText, previewLine } from './preview';

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

  it('grammar 2: never picks a mark quoted in code, and keeps the quoted tags as written', () => {
    expect(previewLine('The form is `<need-input>Which?</need-input>`.\n<to-human>Done.</to-human>', 160)).toBe('Done.');
    expect(previewLine('```\n<need-input>Quoted?</need-input>\n```\nPlain words', 160)).toBe('```');
    expect(previewLine('Use `<to-human>` to mark a message.', 160)).toBe('Use `<to-human>` to mark a message.');
  });

  it('grammar 2: a tag quoted in inline code that spans a line break stays as written', () => {
    expect(previewLine('Quote `<to-human>\nand </to-human>` as written.', 160)).toBe('Quote `<to-human>');
    expect(previewLine('<to-human>Quote `<essential>\na` here.</to-human>', 160)).toBe('Quote `<essential>');
    // A blank line ends the paragraph, so a backtick before it pairs with nothing and hides no tag.
    expect(previewLine('A stray ` <insight>\n\nthen ` end', 160)).toBe('A stray `');
    // Plain runs a mark separates are read apart: their backticks never pair across the mark's paragraphs.
    expect(previewLine('A stray ` <to-human><insight>\n\nNote\n\n</insight>then ` end', 160)).toBe('A stray `');
  });
});


// P2-F (the owner's ruling at P2-F's sitting, A5.3): a side thread's finished summary in its parent's transcript showed
// the literal tags; the card reads the marks, the row shows the words.
describe('markFreeText', () => {
  it('drops every mark kind’s tags and keeps their words where they stood, a question’s choices after its words', () => {
    const report = [
      'Done with the pass.',
      '<to-human>',
      'The report body.',
      '<essential>Decisive: ship it.</essential>',
      '</to-human>',
      '<need-input>Which branch?',
      '<choice recommended>main</choice>',
      '<choice>dev</choice></need-input>',
      '<insight>A note.</insight>',
    ].join('\n');
    expect(markFreeText(report)).toBe('Done with the pass.\nThe report body.\nDecisive: ship it.\nWhich branch?\nmain · dev\nA note.');
    expect(markFreeText('<need-input><choice recommended>Alpha</choice><choice>Beta</choice></need-input>')).toBe('Alpha · Beta');
  });

  it('keeps a mark glued to its neighbours apart from them, and plain text as written', () => {
    expect(markFreeText('Intro<essential>Key</essential>Outro')).toBe('Intro\nKey\nOutro');
    expect(markFreeText('Plain words, `code` and <div> stay.')).toBe('Plain words, `code` and <div> stay.');
  });

  it('grammar 2: tags quoted in code keep their literal text, and an unbalanced tag stays as written', () => {
    expect(markFreeText('Use `<to-human>` to mark a message.\n<to-human>Done.</to-human>')).toBe('Use `<to-human>` to mark a message.\nDone.');
    expect(markFreeText('```\n<need-input>Quoted?</need-input>\n```')).toBe('```\n<need-input>Quoted?</need-input>\n```');
    expect(markFreeText('A stray </to-human> tag')).toBe('A stray </to-human> tag');
  });
});
