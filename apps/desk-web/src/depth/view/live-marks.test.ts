// A streaming answer's `<message>` marks, as the depth column hands it to MAWS's row: the text a stored row of the same
// words would be once its marks close, so the to-human Presenter draws an open span as it draws a settled one.
import { parse, parseLive } from '@shared/owner/to-human-parser';
import { describe, expect, it } from 'vitest';
import { liveMarkdown } from './live-marks';

/** What MAWS's Presenter draws of a text: each part's kind and body. */
const drawn = (text: string) => parse(text).map((part) => [part.kind, part.text.trim()]);

describe("a streaming answer's marks", () => {
  it('an open `<message>` draws as a span while its words arrive, its tags never as text', () => {
    const text = 'Checked both.\n\n<message>\nBoth subagents rep';
    expect(drawn(liveMarkdown(text))).toEqual([
      ['plain', 'Checked both.'],
      ['to-human', 'Both subagents rep'],
    ]);
    expect(drawn(liveMarkdown(text))).toEqual(parseLive(text).map((part) => [part.kind, part.text.trim()]));
  });

  it('an old alias reads as its mark, and a closed span stays as written', () => {
    expect(drawn(liveMarkdown('<essential>Merged.</essential> Then <to-human>the next'))).toEqual([
      ['essential', 'Merged.'],
      ['plain', 'Then'],
      ['to-human', 'the next'],
    ]);
    expect(liveMarkdown('<message>Done.</message>')).toBe('<message>Done.</message>');
  });

  it('a tag still arriving is not drawn', () => {
    expect(drawn(liveMarkdown('Nearly there. <mess'))).toEqual([['plain', 'Nearly there.']]);
    expect(drawn(liveMarkdown('<message>Both.</mes'))).toEqual([['to-human', 'Both.']]);
  });

  it('a tag inside a fence or inline code stays literal', () => {
    const fenced = 'The mark is:\n\n```\n<message>quoted</message>\n```\n\nand `<message>` too.';
    expect(liveMarkdown(fenced)).toBe(fenced);
    expect(drawn(fenced)).toEqual([['plain', fenced]]);
  });

  it('a fence still open inside an open span is closed with it, so the span holds the code', () => {
    const text = '<message>\nRun this:\n\n```sh\necho <message>';
    const parts = parse(liveMarkdown(text));
    expect(parts.map((part) => part.kind)).toEqual(['to-human']);
    expect(parts[0].text).toContain('echo <message>');
  });

  it('text with no marks is drawn as it is', () => {
    expect(liveMarkdown('Plain words <b>and a tag</b>.')).toBe('Plain words <b>and a tag</b>.');
  });
});
