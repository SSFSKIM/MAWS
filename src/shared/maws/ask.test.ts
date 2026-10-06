import { describe, expect, it } from 'vitest';
import { askSteerText, parseAskSteer, PendingAskSchema } from './ask';
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
