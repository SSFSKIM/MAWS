// UX wave U5a (M5; Decision Log 49): the person's own prompt is a `user` row with a message uuid that is `editable` or
// carries several comments, which are not editable in place (one text cannot hold their framing) but are still the
// person's message: what `/rewind` targets and what a refusal interrupted.
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { Row } from '../transcript';
import { askSteerText } from '@shared/maws/ask';
import { rowsOf } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import { builder } from '../transcript/model/test-events';
import { isOwnPrompt, rowPrefill, type UserRow } from './edit-prefill';

const ANCHOR: Anchor = { kind: 'browser-element', label: 'Save button', locator: 'form > button.save', pageUrl: 'https://example.com/signup' };
const user = (over: Partial<Extract<Row, { kind: 'user' }>> = {}): Row =>
  ({ id: 'user:u1', turnId: 'turn:u1', at: '2026-11-13T10:00:00.000Z', kind: 'user', messageUuid: 'u1', text: 'text', attachments: [], placeholders: [], lines: 1, editable: true, steer: false, dropped: false, ...over }) as Row;
const SEVERAL = [{ anchor: ANCHOR, text: 'a' }, { anchor: { ...ANCHOR, locator: 'main > h1', label: 'Page title' }, text: 'b' }];

describe('isOwnPrompt', () => {
  it('an editable prompt with a message uuid, and a message of several comments, are the person’s own prompts', () => {
    expect(isOwnPrompt(user())).toBe(true);
    expect(isOwnPrompt(user({ editable: false, comments: SEVERAL }))).toBe(true);
  });

  it('a row with no message uuid, a prompt not editable and carrying no comments, or a row of another kind is not', () => {
    expect(isOwnPrompt(user({ messageUuid: null }))).toBe(false);
    expect(isOwnPrompt(user({ messageUuid: null, editable: false, comments: SEVERAL }))).toBe(false);
    expect(isOwnPrompt(user({ editable: false }))).toBe(false);
    expect(isOwnPrompt({ id: 't', turnId: null, at: '2026-11-13T10:00:00.000Z', kind: 'time', label: 'Today' } as Row)).toBe(false);
  });
});

// UX wave U4b (the joined answer, step 2): Edit on a row the engine joined from an answer envelope and a prompt puts the
// person's words in the box, nothing of the envelope
describe('Edit on a joined answer and prompt', () => {
  it('prefills the prompt alone', () => {
    const question = { id: 'q1', question: 'Which layout should the page use?', header: 'Layout', modality: 'choice' as const, options: [{ label: 'Grid' }, { label: 'List' }] };
    const envelope = askSteerText('ask-1', [question], [{ id: 'q1', question: question.question, status: 'answered', value: ['Grid'] }]);
    const b = builder();
    b.turn('u1', `${envelope}\nAlso fix the footer.`);
    const row = rowsOf(applyEvents(createState(null, null), b.events)).find((r): r is UserRow => r.kind === 'user')!;
    expect(rowPrefill(row).text).toBe('Also fix the footer.');
  });
});
