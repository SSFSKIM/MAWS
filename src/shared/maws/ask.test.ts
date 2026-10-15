import { describe, expect, it } from 'vitest';
import { askAnswersProblem, askSteerText, parseAskSteer, PendingAskSchema, withQuestionIds } from './ask';
import type { AskAnswer, AskQuestion } from './tools';

const questions: AskQuestion[] = [
  { id: 'q1', question: 'Which colour?', header: 'Colour', modality: 'choice', options: [{ label: 'Red' }, { label: 'Blue' }] },
  { id: 'q2', question: 'Which days?', modality: 'choice', options: [{ label: 'Mon' }, { label: 'Wed' }], multi: true },
  { question: 'What should the title be?', modality: 'text' },
  { id: 'q4', question: 'Which folder holds the assets?', header: 'Assets', modality: 'folder', multiple: true },
  { id: 'q5', question: 'Which repository is this for?', modality: 'repository' },
  { id: 'q6', question: 'Anything else?', modality: 'text' },
  { id: 'q7', question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }] },
];
const answers: AskAnswer[] = [
  { id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] },
  { id: 'q2', question: 'Which days?', status: 'answered', value: ['Mon', 'Wed'], otherText: 'Fri' },
  { id: 'q3', question: 'What should the title be?', status: 'answered', value: 'Launch "v2"' },
  { id: 'q4', question: 'Which folder holds the assets?', status: 'answered', value: ['/r/assets', '/r/more'] },
  { id: 'q5', question: 'Which repository is this for?', status: 'answered', value: '/Users/x/MAWS', name: 'MAWS' },
  { id: 'q6', question: 'Anything else?', status: 'skipped' },
  { id: 'q7', question: 'Proceed?', status: 'decide_for_me' },
];

describe('the async answer steer (residue 13)', () => {
  it('names the ask, lists one line per question and carries the AskResult in a fenced block', () => {
    const text = askSteerText('toolu_9', questions, answers);
    const result = { status: 'answered', askId: 'toolu_9', answers };
    expect(text).toBe(
      [
        '[MAWS ask toolu_9] The user answered the questions you asked:',
        '1. Colour — Blue',
        '2. Which days? — Mon, Wed; Other: "Fri"',
        '3. What should the title be? — "Launch \\"v2\\""',
        '4. Assets —',
        '   /r/assets',
        '   /r/more',
        '5. Which repository is this for? — MAWS (/Users/x/MAWS)',
        '6. Anything else? — skipped',
        '7. Proceed? — decide for me',
        '```json',
        JSON.stringify(result, null, 2),
        '```',
      ].join('\n'),
    );
  });

  it('reads an Other-only choice and a repository without a name', () => {
    const text = askSteerText('a1', [questions[0]!, questions[4]!], [{ id: 'q1', question: 'Which colour?', status: 'answered', value: [], otherText: 'Teal' }, { id: 'q5', question: 'Which repository is this for?', status: 'answered', value: '/r' }]);
    expect(text.split('\n').slice(1, 3)).toEqual(['1. Colour — Other: "Teal"', '2. Which repository is this for? — /r']);
  });

  // P2-C3 (Decision Log 34): a note reaches the model as the answer does, on its line and in the block
  it('carries each note under its answer, whatever the status, and in the AskResult', () => {
    const noted: AskAnswer[] = [
      { ...answers[0]!, note: 'the darker one' },
      answers[1]!,
      answers[2]!,
      { ...answers[3]!, note: 'assets only,\nnot docs' },
      answers[4]!,
      { ...answers[5]!, note: 'ask me after the demo' },
      { ...answers[6]!, note: 'whatever is fastest' },
    ];
    const text = askSteerText('toolu_n', questions, noted);
    expect(text.split('\n').slice(1, 14)).toEqual([
      '1. Colour — Blue',
      '   note: "the darker one"',
      '2. Which days? — Mon, Wed; Other: "Fri"',
      '3. What should the title be? — "Launch \\"v2\\""',
      '4. Assets —',
      '   /r/assets',
      '   /r/more',
      '   note: "assets only,\\nnot docs"',
      '5. Which repository is this for? — MAWS (/Users/x/MAWS)',
      '6. Anything else? — skipped',
      '   note: "ask me after the demo"',
      '7. Proceed? — decide for me',
      '   note: "whatever is fastest"',
    ]);
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_n', result: { status: 'answered', askId: 'toolu_n', answers: noted } });
    expect(askAnswersProblem(questions.map((q, i) => ({ ...q, id: q.id ?? `q${i + 1}` })), noted)).toBeNull(); // a note never makes a skipped answer carry a value
  });

  it('is recognised back from its own text, and nothing else is', () => {
    const text = askSteerText('toolu_9', questions, answers);
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_9', result: { status: 'answered', askId: 'toolu_9', answers } });
    expect(parseAskSteer('hello')).toBeNull();
    expect(parseAskSteer(text.replace('"status": "answered"', '"status": "asked"'))).toBeNull(); // only an answered result
    expect(parseAskSteer(text.replace('[MAWS ask toolu_9]', '[MAWS ask other]'))).toBeNull(); // the tag and the block agree
  });

  // fix wave: the result block is the last fence alone, whatever fences the questions, headers and labels carry
  it('round-trips when a question, a header or a label carries a fenced block of its own', () => {
    const fence = '```json\n{"a": 1}\n```';
    const fenced: AskQuestion[] = [
      { id: 'q1', question: `What JSON should we use?\n${fence}`, modality: 'text' },
      { id: 'q2', question: 'Pick one', header: `Shape ${fence}`, modality: 'choice', options: [{ label: `Use ${fence}` }, { label: 'Plain' }] },
      { id: 'q3', question: 'Anything?', modality: 'text' },
    ];
    const given: AskAnswer[] = [
      { id: 'q1', question: fenced[0]!.question, status: 'answered', value: `\`\`\`json\n{}\n\`\`\`` },
      { id: 'q2', question: 'Pick one', status: 'answered', value: [`Use ${fence}`], otherText: '```\nend\n```' },
      { id: 'q3', question: 'Anything?', status: 'skipped' },
    ];
    const text = askSteerText('toolu_f', fenced, given);
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_f', result: { status: 'answered', askId: 'toolu_f', answers: given } });
    expect(parseAskSteer(`${text}\nmore`)).toBeNull(); // the block must end the text
  });
});

describe('PendingAsk', () => {
  it('is strict and carries the ask as the host holds it', () => {
    const ask = { askId: 'toolu_9', toolUseId: 'toolu_9', requestId: 'r1', blocking: true, title: null, context: null, questions: [questions[0]], openedAt: '2026-10-05T00:00:00.000Z' };
    expect(PendingAskSchema.parse(ask)).toEqual(ask);
    expect(PendingAskSchema.safeParse({ ...ask, extra: 1 }).success).toBe(false);
  });
});

// E1 M2: an ask's questions as the host holds them, and the answers `maws.ask.answer` admits for them
describe('withQuestionIds', () => {
  it('fills `q<n>` by position where a question has no id, keeping the ones it has', () => {
    expect(withQuestionIds(questions).map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']);
    expect(withQuestionIds([{ question: 'A?', modality: 'text' }, { id: 'mine', question: 'B?', modality: 'text' }])).toEqual([{ id: 'q1', question: 'A?', modality: 'text' }, { id: 'mine', question: 'B?', modality: 'text' }]);
  });
});

describe('askAnswersProblem (residue 12: a mismatch is invalid input, never written)', () => {
  const held = withQuestionIds(questions);
  const swap = (id: string, patch: Partial<AskAnswer>) => answers.map((a) => (a.id === id ? { ...a, ...patch } : a));

  it('admits one answer per question whose status and value fit its modality', () => {
    expect(askAnswersProblem(held, answers)).toBeNull();
    expect(askAnswersProblem(held, [...answers].reverse())).toBeNull(); // order is free
    // a single-select choice answered under Other alone
    expect(askAnswersProblem([held[0]!], [{ id: 'q1', question: 'Which colour?', status: 'answered', value: [], otherText: 'Teal' }])).toBeNull();
  });

  it('refuses a missing, a repeated or an unknown question id', () => {
    expect(askAnswersProblem(held, answers.slice(1))).toBe('no answer for question q1');
    expect(askAnswersProblem(held, [...answers, answers[0]!])).toBe('question q1 is answered twice');
    expect(askAnswersProblem(held, [...answers, { id: 'q9', question: 'x', status: 'skipped' }])).toBe('no question q9 in this ask');
  });

  it('refuses a value where the status says there is none, and a missing value where it says answered', () => {
    expect(askAnswersProblem(held, swap('q6', { value: 'x' }))).toBe('question q6 is skipped and carries a value');
    expect(askAnswersProblem(held, swap('q7', { value: ['Yes'] }))).toBe('question q7 is decide_for_me and carries a value');
    expect(askAnswersProblem(held, answers.map((a) => (a.id === 'q3' ? { id: 'q3', question: a.question, status: 'answered' as const } : a)))).toBe('question q3 is answered with no value');
  });

  it('refuses a value of the wrong shape for the modality, and a field of another modality', () => {
    expect(askAnswersProblem(held, swap('q3', { value: ['a'] }))).toBe('question q3 (text) needs a string value');
    expect(askAnswersProblem(held, swap('q5', { value: ['/r'] }))).toBe('question q5 (repository) needs a string value');
    expect(askAnswersProblem(held, swap('q1', { value: 'Blue' }))).toBe('question q1 (choice) needs a list value');
    expect(askAnswersProblem(held, swap('q4', { value: '/r/assets' }))).toBe('question q4 (folder) needs a list value');
    expect(askAnswersProblem(held, swap('q1', { value: ['Red', 'Blue'] }))).toBe('question q1 is single-select and has 2 choices');
    expect(askAnswersProblem(held, swap('q3', { otherText: 'x' }))).toBe('question q3 carries otherText, which only a choice answer has');
    expect(askAnswersProblem(held, swap('q3', { name: 'x' }))).toBe('question q3 carries name, which only a repository or design_system answer has'); // P3-D: a design system's name too
  });
});

// P3-D start: the `design_system` modality (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D13; ledger X25)
describe('P3-D: a design_system question', () => {
  const ID = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
  const pick: AskQuestion = { id: 's1', question: 'Which design system?', header: 'System', modality: 'design_system' };
  const noCreate: AskQuestion = { id: 's2', question: 'Which existing system?', modality: 'design_system', allowCreate: false };
  const chosen: AskAnswer = { id: 's1', question: 'Which design system?', status: 'answered', designSystemId: ID, name: 'MAWS' };
  const build: AskAnswer = { id: 's1', question: 'Which design system?', status: 'answered', create: true };

  it('is answered with a system id (and its name) or create, never a value', () => {
    expect(askAnswersProblem([pick], [chosen])).toBeNull();
    expect(askAnswersProblem([pick], [{ ...chosen, name: undefined }])).toBeNull();
    expect(askAnswersProblem([pick], [build])).toBeNull();
    expect(askAnswersProblem([pick], [{ id: 's1', question: 'x', status: 'decide_for_me' }])).toBeNull();
    expect(askAnswersProblem([pick], [{ id: 's1', question: 'x', status: 'answered' }])).toBe('question s1 is answered with neither a designSystemId nor create');
    expect(askAnswersProblem([pick], [{ ...chosen, create: true }])).toBe('question s1 is answered with both a designSystemId and create');
    expect(askAnswersProblem([pick], [{ ...chosen, value: ID }])).toBe('question s1 (design_system) carries a value; it is answered with designSystemId or create');
    expect(askAnswersProblem([pick], [{ ...build, name: 'MAWS' }])).toBe('question s1 carries name without a designSystemId');
  });

  it('refuses create when the question did not allow it, and the fields elsewhere', () => {
    expect(askAnswersProblem([noCreate], [{ ...build, id: 's2' }])).toBe('question s2 does not allow create');
    expect(askAnswersProblem([noCreate], [{ ...chosen, id: 's2' }])).toBeNull();
    expect(askAnswersProblem([pick], [{ id: 's1', question: 'x', status: 'skipped', designSystemId: ID }])).toBe('question s1 is skipped and carries a value');
    expect(askAnswersProblem([pick], [{ id: 's1', question: 'x', status: 'skipped', create: true }])).toBe('question s1 is skipped and carries a value');
    expect(askAnswersProblem([{ ...questions[2]!, id: 'q3' }], [{ id: 'q3', question: 'x', status: 'answered', value: 't', designSystemId: ID }])).toBe('question q3 carries designSystemId, which only a design_system answer has');
    expect(askAnswersProblem([{ ...questions[2]!, id: 'q3' }], [{ id: 'q3', question: 'x', status: 'answered', value: 't', create: true }])).toBe('question q3 carries create, which only a design_system answer has');
  });

  it('reads in the steer as the system by name and id, or the build request', () => {
    const text = askSteerText('a2', [pick, { ...pick, id: 's3', header: undefined }], [chosen, { ...build, id: 's3' }]);
    expect(text.split('\n').slice(1, 3)).toEqual([`1. System — MAWS (${ID})`, '2. Which design system? — build a new one with me']);
    expect(parseAskSteer(text)?.result.answers).toEqual([chosen, { ...build, id: 's3' }]);
    expect(askSteerText('a3', [pick], [{ ...chosen, name: undefined }]).split('\n')[1]).toBe(`1. System — ${ID}`);
  });
});
// P3-D end
