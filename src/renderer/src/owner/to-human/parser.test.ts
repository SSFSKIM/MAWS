import { describe, expect, it } from 'vitest';
import { parse } from './parser';

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
  it('mirrors the mod limit: balanced tag mentions inside code still parse as marks', () => {
    expect(parse('Mention `<insight>why</insight>` here.')).toEqual([
      { kind: 'plain', text: 'Mention `' }, { kind: 'insight', text: 'why' }, { kind: 'plain', text: '` here.' },
    ]);
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
