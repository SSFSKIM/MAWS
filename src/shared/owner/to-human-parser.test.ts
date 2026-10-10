import { describe, expect, it } from 'vitest';
import { codeRegions, parse, parseLive, TO_HUMAN_GRAMMAR_VERSION } from './to-human-parser';

// Re-expressed from the owner's mod's marked-text cases, with S0's stored-text rule for unbalanced marks.
describe('stored owner marks', () => {
  it('retains the working record and all marked runs in source order', () => {
    expect(parse('Reading the file.\n<to-human>Done.</to-human>\n<essential>Tests fail.</essential>\nAfter.')).toEqual([
      { kind: 'plain', text: 'Reading the file.\n' }, { kind: 'to-human', text: 'Done.' },
      { kind: 'plain', text: '\n' }, { kind: 'essential', text: 'Tests fail.' }, { kind: 'plain', text: '\nAfter.' },
    ]);
  });
  it('splits nested marks into contiguous runs, resuming the outer mark', () => {
    expect(parse('<to-human>Done.\n<essential>Tests fail.</essential>\nMore.</to-human>')).toEqual([
      { kind: 'to-human', text: 'Done.' }, { kind: 'essential', text: 'Tests fail.' }, { kind: 'to-human', text: 'More.' },
    ]);
  });
  it('preserves choice-only questions beside another report', () => {
    expect(parse('<to-human>Report.</to-human><need-input><choice recommended>A</choice><choice>B</choice></need-input>')).toEqual([
      { kind: 'to-human', text: 'Report.' },
      { kind: 'need-input', text: '', choices: [{ text: 'A', recommended: true }, { text: 'B', recommended: false }] },
    ]);
  });
  it.each([
    '<choice>A<choice>B</choice>',
    '<choice recommended>A<choice>B</choice>',
    '<choice>A<choice>B</choice></choice>',
    '<choice>A', '</choice>A',
  ])('keeps malformed or nested choice markup literal: %s', (markup) => {
    expect(parse(`<need-input>Pick.\n${markup}</need-input>`)).toEqual([{ kind: 'need-input', text: `Pick.\n${markup}` }]);
  });
  it('lifts inline or multiline choices only inside questions', () => {
    for (const gap of [' ', '\n']) expect(parse(`<need-input>Which backend?${gap}<choice> SQLite </choice>${gap}<choice recommended>Postgres</choice></need-input>`)).toEqual([
      { kind: 'need-input', text: 'Which backend?', choices: [{ text: 'SQLite', recommended: false }, { text: 'Postgres', recommended: true }] },
    ]);
    expect(parse('<to-human>Pick.\n<choice>A</choice></to-human>')).toEqual([{ kind: 'to-human', text: 'Pick.\n<choice>A</choice>' }]);
  });
  it('does not interpret unknown tags, attributes, casing, or choice attributes beyond the bare recommended flag', () => {
    const text = '<TO-HUMAN>A</TO-HUMAN><to-human extra>B</to-human><other>C</other>';
    expect(parse(text)).toEqual([{ kind: 'plain', text }]);
    expect(parse('<need-input>Q<choice recommended="true">A</choice></need-input>')).toEqual([{ kind: 'need-input', text: 'Q<choice recommended="true">A</choice>' }]);
  });
  it.each(['<need-input>Which branch', '</to-human>stray', '<to-human>A<essential>B</to-human>C</essential>'])('keeps unbalanced marks literal: %s', (text) => {
    expect(parse(text)).toEqual([{ kind: 'plain', text }]);
  });
  it('an unclosed outer mark cannot swallow a later balanced mark', () => {
    expect(parse('<to-human>Done.\n<essential>Tests fail.</essential>\n<need-input>Which')).toEqual([
      { kind: 'plain', text: '<to-human>Done.\n' }, { kind: 'essential', text: 'Tests fail.' }, { kind: 'plain', text: '\n<need-input>Which' },
    ]);
  });
  it('grammar 2: balanced tag mentions inside inline code stay literal', () => {
    expect(TO_HUMAN_GRAMMAR_VERSION).toBe(2);
    const text = 'Mention `<insight>why</insight>` here.';
    expect(parse(text)).toEqual([{ kind: 'plain', text }]);
  });
  it('keeps unknown and unbalanced inner tags for the Markdown literal-tag pipeline', () => {
    expect(parse('<to-human><script>x</script> and <choice>A</to-human>')).toEqual([
      { kind: 'to-human', text: '<script>x</script> and <choice>A' },
    ]);
  });
  it('handles same-kind nesting, empty spans, and empty choices', () => {
    expect(parse('<to-human>A<to-human>B</to-human>C</to-human><insight> </insight>')).toEqual([
      { kind: 'to-human', text: 'A' }, { kind: 'to-human', text: 'B' }, { kind: 'to-human', text: 'C' },
    ]);
    expect(parse('<need-input>Q<choice> </choice></need-input>')).toEqual([{ kind: 'need-input', text: 'Q' }]);
  });
});

// Grammar 2 (P2-C Design §4): tag tokens inside a code region (a fenced block, or an inline code span within a paragraph)
// are literal; everything else is S0's grammar.
describe('grammar 2: code regions', () => {
  it('a fenced example of the vocabulary stays literal, with backticks or tildes', () => {
    for (const fence of ['```', '~~~~']) {
      const text = `The vocabulary:\n${fence}md\n<need-input>Which?\n<choice recommended>A</choice>\n</need-input>\n${fence}\nDone.`;
      expect(parse(text)).toEqual([{ kind: 'plain', text }]);
    }
  });
  it('an unclosed fence runs to the end of the text', () => {
    const text = 'Intro\n```\n<to-human>x</to-human>';
    expect(parse(text)).toEqual([{ kind: 'plain', text }]);
  });
  it('a mark that contains a fenced block stays a mark and keeps the block', () => {
    expect(parse('<to-human>Run this:\n```sh\npnpm test\n```\nThen tell me.</to-human>')).toEqual([
      { kind: 'to-human', text: 'Run this:\n```sh\npnpm test\n```\nThen tell me.' },
    ]);
  });
  it('a closing tag quoted in a fence inside a mark does not close the mark', () => {
    expect(parse('<to-human>Example:\n```\n</to-human>\n```\nEnd.</to-human>')).toEqual([
      { kind: 'to-human', text: 'Example:\n```\n</to-human>\n```\nEnd.' },
    ]);
  });
  it('a closing fence glued to a closing tag still closes, leaving the tag and the marks after it outside code', () => {
    for (const fence of ['```', '~~~']) {
      expect(parse(`<to-human>Run this:\n${fence}bash\nnpm test\n${fence}</to-human>\n<need-input>Go?</need-input>`)).toEqual([
        { kind: 'to-human', text: `Run this:\n${fence}bash\nnpm test\n${fence}` }, { kind: 'plain', text: '\n' }, { kind: 'need-input', text: 'Go?' },
      ]);
    }
    expect(parse('<to-human>A:\n```\nx\n``` </to-human> <essential>\nB</essential>')).toEqual([
      { kind: 'to-human', text: 'A:\n```\nx\n```' }, { kind: 'plain', text: ' ' }, { kind: 'essential', text: 'B' },
    ]);
  });
  it('an opening fence glued to an opening tag still opens, after the tag', () => {
    expect(parse('<to-human>```bash\nnpm test\n```\n</to-human>\n<need-input>Go?</need-input>')).toEqual([
      { kind: 'to-human', text: '```bash\nnpm test\n```' }, { kind: 'plain', text: '\n' }, { kind: 'need-input', text: 'Go?' },
    ]);
    expect(parse('<to-human><essential>```\n</essential>\n```</essential></to-human>')).toEqual([
      { kind: 'essential', text: '```\n</essential>\n```' },
    ]);
  });
  // Decision Log 27 (amended): the glued-tag reading is a recovery, taken only when the strict reading leaves a mark tag
  // unpaired and it pairs them all; a report the strict reading already balances parses exactly as before.
  it('a balanced report quoting a fenced example with a glued line keeps the example literal', () => {
    const text = '<to-human>Example syntax:\n```text\n```</to-human>\n<need-input>Example only?</need-input>\n```\nEnd of example.</to-human>';
    expect(parse(text)).toEqual([{ kind: 'to-human', text: 'Example syntax:\n```text\n```</to-human>\n<need-input>Example only?</need-input>\n```\nEnd of example.' }]);
  });
  it('a multiline inline span opening right after a tag stays an inline span, and the marks after it count', () => {
    expect(parse('<to-human>```foo\nbar```</to-human>\n<essential>Do not miss this.</essential>')).toEqual([
      { kind: 'to-human', text: '```foo\nbar```' }, { kind: 'plain', text: '\n' }, { kind: 'essential', text: 'Do not miss this.' },
    ]);
  });
  it('a glued reading that still leaves a tag unpaired is not taken', () => {
    const text = '<to-human>A:\n```\nx\n```</to-human>\n<need-input>Go?';
    expect(parse(text)).toEqual([{ kind: 'plain', text }]);
  });
  it('text other than tags beside a fence keeps the line from being a fence', () => {
    expect(parse('x <essential>```\n<to-human>Shown.</to-human>')).toEqual([
      { kind: 'plain', text: 'x <essential>```\n' }, { kind: 'to-human', text: 'Shown.' },
    ]);
    const closing = '```\n``` and </to-human>\n<to-human>z</to-human>';
    expect(parse(closing)).toEqual([{ kind: 'plain', text: closing }]);
  });
  it('a fence closes only on the same character, at least as long', () => {
    expect(parse('````\n```\n~~~~\n<to-human>quoted</to-human>\n````\n<to-human>Shown.</to-human>')).toEqual([
      { kind: 'plain', text: '````\n```\n~~~~\n<to-human>quoted</to-human>\n````\n' }, { kind: 'to-human', text: 'Shown.' },
    ]);
  });
  it('a backtick line whose info string holds a backtick is an inline span, not a fence', () => {
    expect(parse('```<to-human>x</to-human>```\n<to-human>Shown.</to-human>')).toEqual([
      { kind: 'plain', text: '```<to-human>x</to-human>```\n' }, { kind: 'to-human', text: 'Shown.' },
    ]);
  });
  it('an inline span of N backticks closes only on a run of exactly N', () => {
    const text = 'Use ``a ` <to-human>x</to-human>`` ok';
    expect(parse(text)).toEqual([{ kind: 'plain', text }]);
  });
  it('a backtick run with no partner is literal and hides nothing', () => {
    expect(parse('A stray ` then <to-human>Done.</to-human>')).toEqual([
      { kind: 'plain', text: 'A stray ` then ' }, { kind: 'to-human', text: 'Done.' },
    ]);
  });
  it('an inline span does not cross a blank line', () => {
    expect(parse('A ` start\n\n<to-human>Done.</to-human> and ` end')).toEqual([
      { kind: 'plain', text: 'A ` start\n\n' }, { kind: 'to-human', text: 'Done.' }, { kind: 'plain', text: ' and ` end' },
    ]);
  });
  it('pairs each run with the next run of its length, past unpaired runs of other lengths', () => {
    // `` opens and closes around the lone `; the ``` before them has no partner and stays literal.
    expect(codeRegions('``` x `` a ` b `` y ` z `')).toEqual([[6, 17], [20, 25]]);
  });
  it('pairing is linear: a long line of many spans reads in well under a second', () => {
    // Pinned (L152): the earlier pairing rescanned every run for each opener, about 5 s for this line.
    const line = '`a` '.repeat(50_000);
    const started = performance.now();
    const regions = codeRegions(line);
    const elapsed = performance.now() - started;
    expect(regions).toHaveLength(50_000);
    expect(regions.at(-1)).toEqual([4 * 49_999, 4 * 49_999 + 3]);
    expect(elapsed).toBeLessThan(500);
  });
  it('choice markup quoted in code inside a question stays in its text', () => {
    expect(parse('<need-input>Which form?\nWrite `<choice>A</choice>` lines.\n<choice recommended>Yes</choice>\n</need-input>')).toEqual([
      { kind: 'need-input', text: 'Which form?\nWrite `<choice>A</choice>` lines.', choices: [{ text: 'Yes', recommended: true }] },
    ]);
  });
});

// Display only (Design §4): while a block streams, a final unclosed mark reads as open so its card fills in.
describe('parseLive', () => {
  it('reads an unclosed trailing to-human as open, which parse keeps literal', () => {
    expect(parseLive('Working.\n<to-human>Plan: first the schema')).toEqual([
      { kind: 'plain', text: 'Working.\n' }, { kind: 'to-human', text: 'Plan: first the schema' },
    ]);
    expect(parse('Working.\n<to-human>Plan: first the schema')).toEqual([{ kind: 'plain', text: 'Working.\n<to-human>Plan: first the schema' }]);
  });
  it('keeps every mark still open, outer and inner', () => {
    expect(parseLive('<to-human>Done.\n<essential>Tests')).toEqual([{ kind: 'to-human', text: 'Done.' }, { kind: 'essential', text: 'Tests' }]);
  });
  it('drops a tag still arriving at the end', () => {
    expect(parseLive('<to-human>Plan</to-hu')).toEqual([{ kind: 'to-human', text: 'Plan' }]);
    expect(parseLive('<to-human>Done.</to-human>\n<need-in')).toEqual([{ kind: 'to-human', text: 'Done.' }, { kind: 'plain', text: '\n' }]);
  });
  it('a mark open around a fence still streaming stays the mark', () => {
    expect(parseLive('<to-human>Run:\n```sh\npnpm')).toEqual([{ kind: 'to-human', text: 'Run:\n```sh\npnpm' }]);
  });
  it('a balanced text reads as parse reads it', () => {
    const text = 'Intro\n<to-human>Done.\n<essential>Tests fail.</essential></to-human>\n<need-input>Q<choice>A</choice></need-input>';
    expect(parseLive(text)).toEqual(parse(text));
  });
});

