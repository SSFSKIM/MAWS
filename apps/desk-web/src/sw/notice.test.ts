import { describe, expect, it } from 'vitest';
import { describeNotice, landingOf, noticeUrl, parseNotice, type Notice } from './notice';

const PROJECT = 'b6d0c2a4-5e1f-4a3b-9c8d-7e6f5a4b3c2d';
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const question: Notice = { v: 1, project: PROJECT, session: SESSION, alias: 'maws-45', kind: 'question', request: 'toolu_01ABC' };
const permission: Notice = { ...question, kind: 'permission', request: 'toolu_02DEF' };
const message: Notice = { v: 1, project: PROJECT, session: SESSION, alias: 'maws-45', kind: 'message', event: { writer: `mini/${SESSION}`, seq: 42 } };
// A question the hub pushed from the log's `question` event (MAWS's async ask, which nothing raises): its event, no request.
const asked: Notice = { v: 1, project: PROJECT, session: SESSION, alias: 'maws-45', kind: 'question', event: { writer: `mini/${SESSION}`, seq: 43 } };

describe('parseNotice', () => {
  it('takes the three kinds the hub sends', () => {
    expect(parseNotice(question)).toEqual(question);
    expect(parseNotice(permission)).toEqual(permission);
    expect(parseNotice(message)).toEqual(message);
  });

  it('takes a question that points to its log event instead of a request; a permission still needs its request', () => {
    expect(parseNotice(asked)).toEqual(asked);
    expect(parseNotice({ ...asked, kind: 'permission' })).toBeNull();
    expect(parseNotice({ ...asked, event: { writer: `mini/${SESSION}`, seq: 0 } })).toBeNull();
  });

  it('takes a null alias', () => {
    expect(parseNotice({ ...question, alias: null })).toEqual({ ...question, alias: null });
  });

  it('refuses what does not point to a card', () => {
    const refused: unknown[] = [
      null,
      'text',
      { ...question, v: 2 },
      { ...question, project: '' },
      { ...question, session: 3 },
      { ...question, kind: 'other' },
      { ...question, request: undefined },
      { ...question, alias: 7 },
      { ...message, event: undefined },
      { ...message, event: { writer: 'mini/x', seq: 0 } },
      { ...message, event: { writer: 'mini/x', seq: 1.5 } },
      { ...message, event: { writer: '', seq: 3 } },
    ];
    for (const value of refused) expect(parseNotice(value), JSON.stringify(value)).toBeNull();
  });
});

describe("the org's waiting count, for the app icon's badge", () => {
  it('is read when the hub sends it, and absent when it does not', () => {
    expect(parseNotice({ ...question, waiting: 4 })).toEqual({ ...question, waiting: 4 });
    expect(parseNotice({ ...question, waiting: 0 })).toEqual({ ...question, waiting: 0 });
    expect(parseNotice(question)).not.toHaveProperty('waiting');
  });

  it('is dropped, not the notice, when it is not a count', () => {
    for (const waiting of [-1, 1.5, '3', null]) expect(parseNotice({ ...question, waiting })).toEqual(question);
  });
});

describe('noticeUrl and landingOf', () => {
  it("opens a request's card in its session's channel", () => {
    const url = noticeUrl(question);
    expect(url).toBe(`/p/${PROJECT}/s/${SESSION}?request=toolu_01ABC`);
    expect(landingOf(new URL(url, 'https://desk.example').search)).toEqual({ kind: 'request', request: 'toolu_01ABC' });
  });

  it("opens a message in its session's channel by its writer and seq", () => {
    const url = noticeUrl(message);
    const parsed = new URL(url, 'https://desk.example');
    expect(parsed.pathname).toBe(`/p/${PROJECT}/s/${SESSION}`);
    expect(landingOf(parsed.search)).toEqual({ kind: 'event', writer: `mini/${SESSION}`, seq: 42 });
  });

  it("opens a question the log reported at its event, in its session's channel", () => {
    const parsed = new URL(noticeUrl(asked), 'https://desk.example');
    expect(parsed.pathname).toBe(`/p/${PROJECT}/s/${SESSION}`);
    expect(landingOf(parsed.search)).toEqual({ kind: 'event', writer: `mini/${SESSION}`, seq: 43 });
  });

  it('encodes ids that are not URL-safe and reads them back', () => {
    const odd: Notice = { ...question, project: 'a/b c', session: 's?1', request: 'r&x=1#y' };
    const parsed = new URL(noticeUrl(odd), 'https://desk.example');
    expect(parsed.pathname).toBe('/p/a%2Fb%20c/s/s%3F1');
    expect(landingOf(parsed.search)).toEqual({ kind: 'request', request: 'r&x=1#y' });
  });

  it('reads no landing from a URL without one, or with a broken one', () => {
    expect(landingOf('')).toBeNull();
    expect(landingOf('?writer=mini/x')).toBeNull();
    expect(landingOf('?writer=mini/x&seq=abc')).toBeNull();
    expect(landingOf('?request=')).toBeNull();
  });
});

describe('describeNotice', () => {
  it('says who wants what, from the payload alone, and never offers an answer', () => {
    const q = describeNotice(question);
    expect(q.title).toBe('maws-45 has a question for you');
    expect(q.options.body).toBe('Opens at the question');
    expect(q.options.data).toEqual({ url: noticeUrl(question) });
    expect(q.options).not.toHaveProperty('actions');
    expect(describeNotice(permission).title).toBe('maws-45 is waiting for your approval');
    expect(describeNotice(permission).options.body).toBe('Opens at the request');
    expect(describeNotice(message).title).toBe('maws-45 sent you a message');
    expect(describeNotice(message).options.body).toBe('Opens in maws-45’s channel');
    // A question the log reported reads as any question, whichever pointer it carries.
    const fromLog = describeNotice(parseNotice({ ...asked, name: 'MAWS' }));
    expect(fromLog.title).toBe('maws-45 has a question for you');
    expect(fromLog.options.body).toBe('MAWS · Opens at the question');
    expect(fromLog.options.data).toEqual({ url: `/p/${PROJECT}/s/${SESSION}?writer=mini%2F${SESSION}&seq=43` });
  });

  it("puts the project's name before where the tap opens, when the hub sends it", () => {
    expect(parseNotice({ ...question, name: 'MAWS' })).toEqual({ ...question, name: 'MAWS' });
    expect(describeNotice({ ...question, name: 'MAWS' }).options.body).toBe('MAWS · Opens at the question');
    expect(describeNotice({ ...permission, name: 'MAWS' }).options.body).toBe('MAWS · Opens at the request');
    expect(describeNotice({ ...message, name: 'MAWS' }).options.body).toBe('MAWS · Opens in maws-45’s channel');
    for (const name of ['', 7, null]) expect(parseNotice({ ...question, name })).toEqual(question);
  });

  it('names a session the hub has no alias for', () => {
    expect(describeNotice({ ...question, alias: null }).title).toBe('A session has a question for you');
    expect(describeNotice({ ...message, alias: null }).options.body).toBe('Opens in its channel');
  });

  it('tags one notification per card, so a repeat replaces it', () => {
    expect(describeNotice(question).options.tag).toBe(`${PROJECT}/request/toolu_01ABC`);
    expect(describeNotice(message).options.tag).toBe(`${PROJECT}/event/mini/${SESSION}/42`);
    expect(describeNotice(asked).options.tag).toBe(`${PROJECT}/event/mini/${SESSION}/43`);
  });

  it('bounds an alias that is too long for a title', () => {
    const title = describeNotice({ ...question, alias: 'x'.repeat(200) }).title;
    expect(title.length).toBeLessThan(100);
    expect(title).toMatch(/^x+… has a question for you$/);
  });

  it('draws a payload it cannot read as a plain prompt to open the desk', () => {
    const unknown = describeNotice(null);
    expect(unknown.title).toBe('The desk');
    expect(unknown.options.body).toBe('Something needs you. Open the desk to see it.');
    expect(unknown.options.data).toEqual({ url: '/' });
  });
});
