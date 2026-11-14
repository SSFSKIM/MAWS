// UX wave U5a (M5; Decision Log 49): the person's own prompt is a `user` row with a message uuid that is `editable` or
// carries several comments, which are not editable in place (one text cannot hold their framing) but are still the
// person's message: what `/rewind` targets and what a refusal interrupted.
import { describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { Row } from '../transcript';
import { isOwnPrompt } from './edit-prefill';

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
