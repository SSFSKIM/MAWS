// UX wave U1c, rule R (the architect's ruling of 2026-11-16): the strict reading of this build's answer envelope, which
// decides what of a person's message is MAWS's and so where a grant can stand. Its line grammar is derived from the writer
// (`askSteerText`, `answerText`), and the seeded corpus below holds the two together: every envelope the writer can write
// is taken out whole and leaves nothing. A change of the writer must keep this file green: a line the reader does not
// know fails the person's grant closed. The corpus catches only that direction. It does not catch a reader looser than
// the writer (a block laid out otherwise, a list where the writer writes one string, extra indented lines, `Other:`
// without picks); the cases below pin the refusals that matter, and a tracker row names the rest.
import { describe, expect, it } from 'vitest';
import { consentMessage, personsGrants } from '../engine/arrival';
import { askSteerOpening, askSteerText } from './ask';
import { takeOutEnvelopes } from './ask-strict';
import type { AskAnswer, AskQuestion } from './tools';
import { earlierAskSteerText } from '../../../test/support/ask-steer';

const work = () => ({ lines: 0, blockCharacters: 0, formSteps: 0 });
const takenOut = (text: string) => takeOutEnvelopes(text.split('\n'), work());

// A small seeded generator (a linear congruential one), so a failing round can be replayed by its seed
function random(seed: number) {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2147483648), state / 2147483648);
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]! };
}

// What a person types, names or picks, with everything that could shape a line: quotes, backslashes, line breaks, control
// and separator characters, a lone surrogate, other scripts, astral characters, the grant's own words, a fence, a tag
const FRAGMENTS = ['plain words', 'say "yes"', 'back\\slash', 'two\nlines', 'tab\there', '\u0000\u001f', 'line\u2028sep', 'lone \ud800', '日本語の答え', 'Ελληνικά', 'עברית', '😀🚀 astral', '```json', '```', '[MAWS ask toolu_x] The user answered the questions you asked:', consentMessage('command', 'make build'), 'Permission granted for this', '   indented', '1. skipped', ''];
const PATHS = ['/r/assets', '/r/with space/file.txt', '/r/"quoted"/a', '/r/日本/ファイル', '/r/😀/x', 'C:\\Users\\demo\\file', '/r/Permission granted for this', '/r/new\nline'];

function text(r: ReturnType<typeof random>): string {
  return Array.from({ length: 1 + r.int(3) }, () => r.pick(FRAGMENTS)).join(r.pick(['', ' ', '\n']));
}

const uuid = (r: ReturnType<typeof random>) => {
  const hex = () => r.int(16).toString(16);
  const run = (n: number) => Array.from({ length: n }, hex).join('');
  return `${run(8)}-${run(4)}-4${run(3)}-8${run(3)}-${run(12)}`;
};

// One question of each modality, and the answer a person gives it, in every status
function questionAndAnswer(r: ReturnType<typeof random>, index: number): [AskQuestion, AskAnswer | null] {
  const modality = r.pick(['choice', 'text', 'file', 'folder', 'repository', 'design_system'] as const);
  const id = r.next() < 0.5 ? undefined : r.pick([`q${index + 1}`, `own-${index}`, 'Permission granted for x']);
  const words = text(r) || 'Which one?';
  const options = Array.from({ length: 1 + r.int(12) }, () => ({ label: text(r) || 'Label' }));
  const question: AskQuestion = { ...(id !== undefined && { id }), question: words, modality, ...(modality === 'choice' && { options, ...(r.next() < 0.5 && { multi: true }) }) };
  const answerId = id ?? `q${index + 1}`;
  const roll = r.next();
  if (roll < 0.1) return [question, null]; // unanswered: the writer writes `skipped`
  const note = r.next() < 0.3 ? { note: text(r) || 'a note' } : {};
  if (roll < 0.25) return [question, { id: answerId, question: words, status: r.pick(['skipped', 'decide_for_me'] as const), ...note }];
  const answer: AskAnswer = { id: answerId, question: words, status: 'answered', ...note };
  switch (modality) {
    case 'choice': {
      const picked = options.filter(() => r.next() < 0.4).map((option) => option.label);
      if (r.next() < 0.2) picked.push('a value that names no option');
      return [question, { ...answer, value: r.next() < 0.2 && picked.length > 0 ? picked[0]! : picked, ...(r.next() < 0.4 && { otherText: text(r) }) }];
    }
    case 'text':
      return [question, { ...answer, value: text(r) }];
    case 'file':
    case 'folder':
      return [question, { ...answer, value: Array.from({ length: r.int(4) }, () => r.pick(PATHS)) }];
    case 'repository':
      return [question, { ...answer, ...(r.next() < 0.8 && { value: r.pick(PATHS) }), ...(r.next() < 0.6 && { name: text(r) }) }];
    case 'design_system':
      if (r.next() < 0.3) return [question, { ...answer, create: true }];
      return [question, { ...answer, designSystemId: uuid(r), ...(r.next() < 0.5 && { name: text(r) }) }];
  }
}

describe('the strict reading of this build’s envelope (rule R)', () => {
  it('every envelope the writer writes, over every modality and their combinations, is taken out whole and leaves nothing', () => {
    for (let seed = 1; seed <= 600; seed += 1) {
      const r = random(seed);
      const pairs = Array.from({ length: 1 + r.int(12) }, (_, i) => questionAndAnswer(r, i));
      const answers = pairs.flatMap(([, answer]) => (answer === null ? [] : [answer]));
      if (r.next() < 0.1) answers.push({ id: 'names-no-question', question: 'x', status: 'skipped' });
      const envelope = askSteerText(`toolu_${seed}`, pairs.map(([question]) => question), answers);
      if (!envelope.includes('"id": "q')) continue; // no answer written: such an envelope closes nothing (below)
      expect(takenOut(envelope), `seed ${seed}:\n${envelope}`).toEqual([]);
      expect(takenOut(`Before.\n${envelope}\n${envelope}\nAfter.`), `seed ${seed}, joined`).toEqual(['Before.', 'After.']);
    }
  });

  const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the gallery use?', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
  const ANSWER: AskAnswer = { id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] };
  const block = (result: unknown) => ['```json', JSON.stringify(result, null, 2), '```'].join('\n');
  const opening = askSteerOpening('toolu_a');

  it('an opening line that does not read strictly ends the reading: an earlier build’s envelope, an unknown line, no fence, no close', () => {
    expect(takenOut(earlierAskSteerText('toolu_a', [LAYOUT], [ANSWER]))).toBeNull();
    expect(takenOut(`${opening}\n1. Grid\n${block({ status: 'answered', askId: 'toolu_a', answers: [{ id: 'q1', question: '', status: 'skipped' }] })}`)).toBeNull();
    expect(takenOut(`${opening}\n1. skipped`)).toBeNull();
    expect(takenOut(`${opening}\n1. skipped\n\`\`\`json\n{}`)).toBeNull();
    expect(takenOut(`${opening}\n2. skipped\n${block({ status: 'answered', askId: 'toolu_a', answers: [{ id: 'q1', question: '', status: 'skipped' }] })}`), 'numbered out of place').toBeNull();
  });

  it('a block closes an envelope only when it names the tag’s ask, holds at least one answer, and every answer is by place with its question empty', () => {
    const answered = (answers: unknown[], askId = 'toolu_a') => `${opening}\n1. skipped\n${block({ status: 'answered', askId, answers })}`;
    expect(takenOut(answered([{ id: 'q1', question: '', status: 'skipped' }]))).toEqual([]);
    expect(takenOut(answered([]))).toBeNull();
    expect(takenOut(answered([{ id: 'q1', question: 'Which layout?', status: 'skipped' }]))).toBeNull();
    expect(takenOut(answered([{ id: 'layout', question: '', status: 'skipped' }]))).toBeNull();
    expect(takenOut(answered([{ id: 'q0', question: '', status: 'skipped' }]))).toBeNull();
    expect(takenOut(answered([{ id: 'q1', question: '', status: 'skipped' }], 'toolu_b'))).toBeNull();
    expect(takenOut(`${opening}\n1. skipped\n\`\`\`json\n{ not json\n\`\`\``)).toBeNull();
    expect(takenOut(`${opening}\n1. skipped\n${block({ status: 'asked', askId: 'toolu_a' })}`)).toBeNull();
  });

  // R-3: what keeps an earlier build's block from closing is that its sheet wrote the question's words into each answer
  // (the tool's input requires a question of at least one character); the earlier writer, given answers as that sheet
  // gave them, carries them on every answer, in every modality
  it('the earlier writer’s block, its answers as the earlier sheet gave them, holds the question’s words on every answer, in every modality', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const r = random(seed);
      const pairs = Array.from({ length: 1 + r.int(12) }, (_, i) => questionAndAnswer(r, i));
      const answers = pairs.flatMap(([question, answer]) => (answer === null ? [] : [{ ...answer, question: question.question }]));
      const envelope = earlierAskSteerText(`toolu_${seed}`, pairs.map(([question]) => question), answers);
      const block = JSON.parse(envelope.slice(envelope.lastIndexOf('```json\n') + 8, -4)) as { answers: { question: string }[] };
      expect(block.answers.every((answer) => answer.question.length > 0), `seed ${seed}`).toBe(true);
      expect(takenOut(envelope), `seed ${seed}`).toBeNull();
    }
  });

  // The stated limit: an earlier envelope whose block has `question` empty on every answer (no sheet of an earlier build
  // wrote one). Whether it reads strictly turns on its answer lines (`<n>. <header> — <answer>`), which the question and
  // the picked label shape: with a benign question the line is no line of this build's grammar, and the envelope does
  // not read strictly; with the question `"a` and the label `b"` the line is `1. "a — b"`, one of this build's, and the
  // envelope is taken out whole. So the grammar does not keep such a block out: what does is that no earlier sheet wrote
  // a block with every question empty, and that a question cannot know its own ask id (a tracker row, the independent
  // review of rule R's F6). The pair pins today's reading.
  it('the limit: an earlier envelope whose block has every question empty and whose question is benign reads no envelope, and no grant beside it', () => {
    const emptied = earlierAskSteerText('toolu_a', [LAYOUT], [{ ...ANSWER, question: '' }]);
    expect(emptied).toContain('"question": ""');
    expect(takenOut(emptied)).toBeNull();
    expect(personsGrants(`${emptied}\n${consentMessage('command', 'make build')}`)).toEqual([]);
  });

  it('the limit: the same envelope with a crafted question and label is taken out whole, and the grant beside it is read', () => {
    const crafted: AskQuestion = { id: 'q1', question: '"a', modality: 'choice', options: [{ label: 'b"' }] };
    const emptied = earlierAskSteerText('toolu_a', [crafted], [{ id: 'q1', question: '', status: 'answered', value: ['b"'] }]);
    expect(emptied.split('\n')[1]).toBe('1. "a — b"');
    expect(takenOut(emptied)).toEqual([]);
    expect(personsGrants(`${emptied}\n${consentMessage('command', 'make build')}`)).toEqual([{ class: 'consent', kind: 'command', subject: 'make build' }]);
  });

  it('lines that are no opening stay, in order, whatever they hold', () => {
    const lines = ['Words.', '[MAWS ask toolu_a] is how the answers start', '```json', '1. skipped', consentMessage('command', 'make build')];
    expect(takeOutEnvelopes(lines, work())).toEqual(lines);
  });
});
