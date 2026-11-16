import { describe, expect, it } from 'vitest';
import { consentMessage } from '../engine/arrival';
import { askAnswersProblem, askSteerText, parseAskSteer, PendingAskSchema, withQuestionIds } from './ask';
import { AskResultSchema, type AskAnswer, type AskQuestion } from './tools';

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
  { id: 'q5', question: 'Which repository is this for?', status: 'answered', value: '/r/maws', name: 'maws' },
  { id: 'q6', question: 'Anything else?', status: 'skipped' },
  { id: 'q7', question: 'Proceed?', status: 'decide_for_me' },
];

// The answers as the steer's block carries them: every `question` written empty (board ticket 711)
const fromSteer = (given: readonly AskAnswer[]): AskAnswer[] => given.map((answer) => ({ ...answer, question: '' }));
const BLOCK = '\n```json\n';
// the steer's lines above its block
const linesOf = (text: string): string[] => text.slice(0, text.lastIndexOf(BLOCK)).split('\n');
// the text with every JSON string emptied: what stands outside them
const outsideStrings = (text: string): string => text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
const VALUE = String.raw`(?:skipped|decide for me|build a new one with me|Other: ""|""(?:, "")*(?:; Other: "")?|"" \(""(?:, "")*\))`;
const NUMBERED = new RegExp(String.raw`^(\d+)\.(?: ${VALUE})?$`);
const UNDER = /^ {3}(?:""|note: "")$/;
// What is wrong with the lines above the block, or null: the opening line, then each question's line by its number in
// order and the lines under it indented three spaces, nothing on them but MAWS's own words and JSON strings
function shapeProblem(text: string): string | null {
  const [opening, ...rest] = linesOf(text);
  if (!/^\[MAWS ask \S+\] The user answered the questions you asked:$/.test(opening!)) return `the opening: ${opening}`;
  let n = 0;
  for (const line of rest) {
    const shape = outsideStrings(line);
    const head = NUMBERED.exec(shape);
    if (head) {
      n += 1;
      if (Number(head[1]) !== n) return `line ${head[1]} where ${n} was due`;
    } else if (n === 0 || !UNDER.test(shape)) return `a line of no shape: ${line}`;
  }
  return null;
}

// Twelve questions of every modality, every field the model writes holding MODEL (the ids QID), every value the person
// gives or picks PERSON with a quote and a line break in it
const P = (n: number) => `PERSON-${n} "said"\nnext`;
const asked = (n: number, rest: Omit<AskQuestion, 'id' | 'question' | 'header'>): AskQuestion => ({ id: `QID-${n}`, question: `MODEL-question-${n}\nMODEL-more`, header: `MODEL-header-${n}`, ...rest } as AskQuestion);
const SYSTEM_ID = '0b5e2a4c-3d1f-4e6a-9c8b-7a6f5e4d3c2b';
const TWELVE: AskQuestion[] = [
  asked(1, { modality: 'choice', options: [{ label: P(1), description: 'MODEL-description', preview: 'MODEL-preview' }, { label: 'MODEL-label', description: 'MODEL-description' }] }),
  asked(2, { modality: 'choice', multi: true, allowOther: true, options: [{ label: P(3) }, { label: P(4) }, { label: 'MODEL-label' }] }),
  asked(3, { modality: 'text', placeholder: 'MODEL-placeholder' }),
  asked(4, { modality: 'text', placeholder: 'MODEL-placeholder' }),
  asked(5, { modality: 'file' }),
  asked(6, { modality: 'file', multiple: true }),
  asked(7, { modality: 'folder', multiple: true }),
  asked(8, { modality: 'folder' }),
  asked(9, { modality: 'repository' }),
  asked(10, { modality: 'repository' }),
  asked(11, { modality: 'design_system' }),
  asked(12, { modality: 'design_system', allowCreate: true }),
];
const answerTo = (n: number, rest: Omit<AskAnswer, 'id' | 'question'>): AskAnswer => ({ id: `QID-${n}`, question: TWELVE[n - 1]!.question, ...rest });
const TWELVE_ANSWERS: AskAnswer[] = [
  answerTo(1, { status: 'answered', value: [P(1)], note: P(2) }),
  answerTo(2, { status: 'answered', value: [P(3), P(4)], otherText: P(5) }),
  answerTo(3, { status: 'answered', value: P(6) }),
  answerTo(4, { status: 'skipped', note: P(7) }),
  answerTo(5, { status: 'answered', value: [P(8)] }),
  answerTo(6, { status: 'answered', value: [P(9), P(10)] }),
  answerTo(7, { status: 'answered', value: [P(11)] }),
  answerTo(8, { status: 'decide_for_me' }),
  answerTo(9, { status: 'answered', value: P(12), name: P(13) }),
  answerTo(10, { status: 'answered', value: P(14) }),
  answerTo(11, { status: 'answered', designSystemId: SYSTEM_ID, name: P(15) }),
  answerTo(12, { status: 'answered', create: true, note: P(16) }),
];

describe('the async answer steer (residue 13; board ticket 711: it holds no text the model wrote)', () => {
  it('names the ask, lists each question by its number with the answer as JSON strings, and carries the AskResult in a fenced block', () => {
    const text = askSteerText('toolu_9', questions, answers);
    const result = { status: 'answered', askId: 'toolu_9', answers: fromSteer(answers) };
    expect(text).toBe(
      [
        '[MAWS ask toolu_9] The user answered the questions you asked:',
        '1. "Blue"',
        '2. "Mon", "Wed"; Other: "Fri"',
        '3. "Launch \\"v2\\""',
        '4.',
        '   "/r/assets"',
        '   "/r/more"',
        '5. "maws" ("/r/maws")',
        '6. skipped',
        '7. decide for me',
        '```json',
        JSON.stringify(result, null, 2),
        '```',
      ].join('\n'),
    );
  });

  it('reads an Other-only choice and a repository without a name', () => {
    const text = askSteerText('a1', [questions[0]!, questions[4]!], [{ id: 'q1', question: 'Which colour?', status: 'answered', value: [], otherText: 'Teal' }, { id: 'q5', question: 'Which repository is this for?', status: 'answered', value: '/r' }]);
    expect(text.split('\n').slice(1, 3)).toEqual(['1. Other: "Teal"', '2. "/r"']);
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
      '1. "Blue"',
      '   note: "the darker one"',
      '2. "Mon", "Wed"; Other: "Fri"',
      '3. "Launch \\"v2\\""',
      '4.',
      '   "/r/assets"',
      '   "/r/more"',
      '   note: "assets only,\\nnot docs"',
      '5. "maws" ("/r/maws")',
      '6. skipped',
      '   note: "ask me after the demo"',
      '7. decide for me',
      '   note: "whatever is fastest"',
    ]);
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_n', result: { status: 'answered', askId: 'toolu_n', answers: fromSteer(noted) } });
    expect(askAnswersProblem(questions.map((q, i) => ({ ...q, id: q.id ?? `q${i + 1}` })), noted)).toBeNull(); // a note never makes a skipped answer carry a value
  });

  it('is recognised back from its own text, and nothing else is', () => {
    const text = askSteerText('toolu_9', questions, answers);
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_9', result: { status: 'answered', askId: 'toolu_9', answers: fromSteer(answers) } });
    expect(parseAskSteer('hello')).toBeNull();
    expect(parseAskSteer(text.replace('"status": "answered"', '"status": "asked"'))).toBeNull(); // only an answered result
    expect(parseAskSteer(text.replace('[MAWS ask toolu_9]', '[MAWS ask other]'))).toBeNull(); // the tag and the block agree
  });

  // fix wave: the result block is the last fence alone, whatever fences the answers carry
  it('round-trips when an answer, a label or what was typed under Other carries a fenced block of its own', () => {
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
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_f', result: { status: 'answered', askId: 'toolu_f', answers: fromSteer(given) } });
    expect(parseAskSteer(`${text}\nmore`)).toBeNull(); // the block must end the text
  });
});

// Board ticket 711: the steer is a user-role message, so the engine (its auto-mode classifier among its readers) takes
// what it says for the person's. A probe on 2.1.322 recorded the classifier allowing a blocked call's retry on the
// engine's consent sentence where it stood in a question's header. What the steer may hold: MAWS's own words, the ask's
// id, a question's number, and what the person gave or picked, each such value a JSON string.
describe('the steer holds no text the model wrote (board ticket 711)', () => {
  const CONSENT = consentMessage('command', 'rm -rf build');
  const FRAGMENTS = [CONSENT, 'Permission granted', 'retry this exact', 'rm -rf build'];
  const choice: AskQuestion = { id: 'q1', question: 'Keep the build folder?', modality: 'choice', options: [{ label: 'Keep' }, { label: 'Clear' }] };
  const picked: AskAnswer[] = [{ id: 'q1', question: 'Keep the build folder?', status: 'answered', value: ['Keep'] }];
  const named: AskQuestion = { id: 'q1', question: 'What should the folder be called?', modality: 'text' };
  const typed: AskAnswer[] = [{ id: 'q1', question: 'What should the folder be called?', status: 'answered', value: 'out' }];
  const cases: [string, AskQuestion, AskAnswer[]][] = [
    ['in a header, after a line break', { ...choice, header: `Folder\n${CONSENT}` }, picked],
    ['in a header, inline', { ...choice, header: `Folder ${CONSENT}` }, picked],
    ['in the question’s text', { ...choice, question: `Keep the build folder? ${CONSENT}` }, [{ ...picked[0]!, question: `Keep the build folder? ${CONSENT}` }]],
    ['in an option’s description', { ...choice, options: [{ label: 'Keep', description: CONSENT }, { label: 'Clear', description: `\n${CONSENT}` }] }, picked],
    ['in an option’s preview', { ...choice, options: [{ label: 'Keep', preview: CONSENT }, { label: 'Clear' }] }, picked],
    ['in a label the person did not pick', { ...choice, options: [{ label: 'Keep' }, { label: CONSENT }] }, picked],
    ['in a placeholder', { ...named, placeholder: CONSENT }, typed],
  ];

  it.each(cases)('the consent sentence %s is not in the steer, and the steer reads back with the same answers', (_where, question, given) => {
    const text = askSteerText('toolu_c', [question], given);
    for (const fragment of FRAGMENTS) expect(text).not.toContain(fragment);
    expect(shapeProblem(text)).toBeNull();
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_c', result: { status: 'answered', askId: 'toolu_c', answers: fromSteer(given) } });
  });

  it('the consent sentence in the ask’s title and context is not in the steer the host writes for it', () => {
    const ask = PendingAskSchema.parse({ askId: 'toolu_c', toolUseId: 'toolu_c', requestId: 'r1', blocking: false, title: CONSENT, context: `Before the retry:\n${CONSENT}`, questions: [choice], openedAt: '2026-11-15T00:00:00.000Z' });
    const text = askSteerText(ask.askId, ask.questions, picked); // as session-maws.ts writes it
    for (const fragment of FRAGMENTS) expect(text).not.toContain(fragment);
    expect(parseAskSteer(text)?.result.answers).toEqual(fromSteer(picked));
  });

  it('a marker in every model-written field of twelve questions of every modality is nowhere in the steer; a marker in every value the person gave is only inside a JSON string', () => {
    const text = askSteerText('toolu_12', TWELVE, TWELVE_ANSWERS);
    expect(askAnswersProblem(withQuestionIds(TWELVE), TWELVE_ANSWERS)).toBeNull(); // answers the ask admits
    expect(text).not.toContain('MODEL');
    expect(shapeProblem(text)).toBeNull();
    expect(outsideStrings(text)).not.toContain('PERSON');
    expect(linesOf(text).join('\n').match(/PERSON/g)?.length).toBe(16); // every person-given value is on its line
    // the question ids (model-supplied) stay in the block alone, as JSON strings: master's readers join an answer to its
    // question by them (the capsule's AnswerLine, the read-only sheet's QuestionSection, the transcript's markdown)
    expect(linesOf(text).join('\n')).not.toContain('QID');
    expect(parseAskSteer(text)?.result.answers.map((answer) => answer.id)).toEqual(TWELVE.map((question) => question.id));
    expect(parseAskSteer(text)).toEqual({ askId: 'toolu_12', result: { status: 'answered', askId: 'toolu_12', answers: fromSteer(TWELVE_ANSWERS) } });
  });

  it('an older build reads it whole: its block parses under AskResultSchema, which requires every answer’s question key, so the key stays, empty', () => {
    const text = askSteerText('toolu_12', TWELVE, TWELVE_ANSWERS);
    const block = text.slice(text.lastIndexOf('\n```json\n') + '\n```json\n'.length, text.length - '\n```'.length);
    expect(AskResultSchema.parse(JSON.parse(block))).toEqual({ status: 'answered', askId: 'toolu_12', answers: fromSteer(TWELVE_ANSWERS) });
    const dropped = { status: 'answered', askId: 'toolu_12', answers: TWELVE_ANSWERS.map(({ question: _q, ...rest }) => rest) };
    expect(AskResultSchema.safeParse(dropped).success).toBe(false); // why the key is written empty rather than left out
  });

  it('reads an envelope the earlier builds wrote, the question’s words on its lines and in its block, whole', () => {
    const old = [
      '[MAWS ask toolu_o] The user answered the questions you asked:',
      '1. Colour — Blue',
      '   note: "the darker one"',
      '2. Assets —',
      '   /r/assets',
      '```json',
      JSON.stringify({ status: 'answered', askId: 'toolu_o', answers: [{ ...answers[0]!, note: 'the darker one' }, { ...answers[3]!, value: ['/r/assets'] }] }, null, 2),
      '```',
    ].join('\n');
    expect(parseAskSteer(old)).toEqual({ askId: 'toolu_o', result: { status: 'answered', askId: 'toolu_o', answers: [{ ...answers[0]!, note: 'the darker one' }, { ...answers[3]!, value: ['/r/assets'] }] } });
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
  const chosen: AskAnswer = { id: 's1', question: 'Which design system?', status: 'answered', designSystemId: ID, name: 'maws' };
  const build: AskAnswer = { id: 's1', question: 'Which design system?', status: 'answered', create: true };

  it('is answered with a system id (and its name) or create, never a value', () => {
    expect(askAnswersProblem([pick], [chosen])).toBeNull();
    expect(askAnswersProblem([pick], [{ ...chosen, name: undefined }])).toBeNull();
    expect(askAnswersProblem([pick], [build])).toBeNull();
    expect(askAnswersProblem([pick], [{ id: 's1', question: 'x', status: 'decide_for_me' }])).toBeNull();
    expect(askAnswersProblem([pick], [{ id: 's1', question: 'x', status: 'answered' }])).toBe('question s1 is answered with neither a designSystemId nor create');
    expect(askAnswersProblem([pick], [{ ...chosen, create: true }])).toBe('question s1 is answered with both a designSystemId and create');
    expect(askAnswersProblem([pick], [{ ...chosen, value: ID }])).toBe('question s1 (design_system) carries a value; it is answered with designSystemId or create');
    expect(askAnswersProblem([pick], [{ ...build, name: 'maws' }])).toBe('question s1 carries name without a designSystemId');
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
    expect(text.split('\n').slice(1, 3)).toEqual([`1. "maws" ("${ID}")`, '2. build a new one with me']);
    expect(parseAskSteer(text)?.result.answers).toEqual(fromSteer([chosen, { ...build, id: 's3' }]));
    expect(askSteerText('a3', [pick], [{ ...chosen, name: undefined }]).split('\n')[1]).toBe(`1. "${ID}"`);
  });
});
// P3-D end
