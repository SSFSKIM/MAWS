import { describe, expect, it } from 'vitest';
import { answersOf, answerText } from './answer';

// Ported from the doperpowers mod (`tests/mods/to-human.test.ts`, "answers"), its cases verbatim: the answer's form is
// the legacy contract (Design §1), read back from prompts given in a terminal through the mod.
describe('answers', () => {
  it('answerText names the question and the choice, and answersOf reads it back', () => {
    const text = answerText('Which backend?', 'Postgres');

    expect(text).toBe('Answering "Which backend?": Postgres');
    expect(answersOf(text)).toEqual([{ head: 'Which backend?', answer: 'Postgres' }]);
    expect(answersOf('Answering "Which backend?": ')).toEqual([{ head: 'Which backend?', answer: '' }]);
    expect(answersOf(answerText('Which format?', 'Use "fast": mode'))).toEqual([{ head: 'Which format?', answer: 'Use "fast": mode' }]);
    expect(answersOf('Just a prompt.')).toEqual([]);
    // The engine frames a prompt a plugin submitted; the transcript keeps the frame.
    expect(
      answersOf('The doperpowers plugin sent a message:\nAnswering "Which backend?": Postgres\n\nThis is how Claude Code surfaces a prompt.'),
    ).toEqual([{ head: 'Which backend?', answer: 'Postgres' }]);
  });

  it('answersOf reads every answer of a prompt, one per line, and leaves the other lines alone', () => {
    const text = 'Answering "Which backend?": Postgres\nAnswering "Which region?": eu-west\nAlso: keep the old data.';

    expect(answersOf(text)).toEqual([
      { head: 'Which backend?', answer: 'Postgres' },
      { head: 'Which region?', answer: 'eu-west' },
    ]);
  });

  it('a multi-line Reply keeps its newlines after the header; the reader takes the header line', () => {
    const text = answerText('Which backend?', 'Postgres.\nKeep the old data.');
    expect(text).toBe('Answering "Which backend?": Postgres.\nKeep the old data.');
    expect(answersOf(text)).toEqual([{ head: 'Which backend?', answer: 'Postgres.' }]);
  });
});
