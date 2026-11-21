// X8, a machine's notice: a `human` event under a machine's human writer (its audience streams included) whose `notice`
// is a non-empty string naming the program that speaks. The field anywhere else marks nothing.
import { describe, expect, it } from 'vitest';
import { noticeOf, noticeSender } from '../src/audience.ts';

const DIGEST = '0123456789abcdef';
const notice = (extra: Record<string, unknown> = {}) => ({ kind: 'human', writer: 'dc-x/human', from: 'human', to: [{ session: 's', alias: 'a' }], text: 'the box is up', notice: 'devcloud', ...extra });

describe('a machine’s notice', () => {
  it('is a human event under `<machine>/human` or its stream, naming its program', () => {
    expect(noticeOf(notice())).toBe('devcloud');
    expect(noticeSender(notice())).toBe('devcloud@dc-x');
    expect(noticeOf(notice({ writer: `dc-x/human~${DIGEST}` }))).toBe('devcloud');
    expect(noticeSender(notice({ writer: `dc-x/human~${DIGEST}` }))).toBe('devcloud@dc-x');
  });

  it('names a program outside the grammar `notice@<machine>`, still a notice', () => {
    for (const program of ['Devcloud', '1st', 'a b', 'x'.repeat(33), 'dev_cloud', 'devcloud@dc-y']) {
      expect(noticeOf(notice({ notice: program })), program).toBe(program);
      expect(noticeSender(notice({ notice: program })), program).toBe('notice@dc-x');
    }
    expect(noticeSender(notice({ notice: 'a' }))).toBe('a@dc-x');
    expect(noticeSender(notice({ notice: `a${'b'.repeat(31)}` }))).toBe(`a${'b'.repeat(31)}@dc-x`);
  });

  it('is nothing on another kind, under another writer, or with an empty or non-string value', () => {
    const none = [
      notice({ kind: 'say' }),
      notice({ kind: 'message' }),
      notice({ writer: 'hub/0123456789abcdef0123456789abcdef' }),
      notice({ writer: `hub/0123456789abcdef0123456789abcdef~${DIGEST}` }),
      notice({ writer: 'dc-x/5e0c1f2a-1111-4111-8111-111111111111' }),
      notice({ writer: 'legacy/human' }),
      notice({ writer: 'Legacy/human' }),
      notice({ writer: 'HUB/human' }),
      notice({ writer: 'bad machine/human' }),
      notice({ writer: `bad machine/human~${DIGEST}` }),
      notice({ writer: '-x/human' }),
      notice({ writer: 'dc-x/human~nothex' }),
      notice({ writer: 'dc-x/humans' }),
      notice({ notice: '' }),
      notice({ notice: 7 }),
      notice({ notice: true }),
      notice({ notice: null }),
      { ...notice(), notice: undefined },
      { kind: 'human', writer: 'dc-x/human', text: 'the owner' },
      null,
      'human',
      [],
    ];
    for (const event of none) {
      expect(noticeOf(event), JSON.stringify(event)).toBeNull();
      expect(noticeSender(event), JSON.stringify(event)).toBeNull();
    }
  });
});
