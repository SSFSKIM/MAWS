import { describe, expect, it } from 'vitest';
import type { PushNotice } from 'desk-hub/protocol';
import { describeNotice, landingOf, noticeUrl, parseNotice } from './notice';

const PROJECT = 'b6d0c2a4-5e1f-4a3b-9c8d-7e6f5a4b3c2d';
const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const question: PushNotice = { v: 1, project: PROJECT, session: SESSION, alias: 'maws-45', kind: 'question', request: 'toolu_01ABC' };
const permission: PushNotice = { ...question, kind: 'permission', request: 'toolu_02DEF' };
const message: PushNotice = { v: 1, project: PROJECT, session: SESSION, alias: 'maws-45', kind: 'message', event: { writer: `mini/${SESSION}`, seq: 42 } };

describe('parseNotice', () => {
  it('takes the three kinds the hub sends', () => {
    expect(parseNotice(question)).toEqual(question);
    expect(parseNotice(permission)).toEqual(permission);
    expect(parseNotice(message)).toEqual(message);
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

  it('encodes ids that are not URL-safe and reads them back', () => {
    const odd: PushNotice = { ...question, project: 'a/b c', session: 's?1', request: 'r&x=1#y' };
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
    expect(q.title).toBe('maws-45 has a question');
    expect(q.options.body).toBe('Open the desk to answer it.');
    expect(q.options.data).toEqual({ url: noticeUrl(question) });
    expect(q.options).not.toHaveProperty('actions');
    expect(describeNotice(permission).title).toBe('maws-45 asks for your permission');
    expect(describeNotice(permission).options.body).toBe('Open the desk to allow or deny it.');
    expect(describeNotice(message).title).toBe('maws-45 sent you a message');
    expect(describeNotice(message).options.body).toBe('Open the desk to read it.');
  });

  it('names a session the hub has no alias for', () => {
    expect(describeNotice({ ...question, alias: null }).title).toBe('A session has a question');
  });

  it('tags one notification per card, so a repeat replaces it', () => {
    expect(describeNotice(question).options.tag).toBe(`${PROJECT}/request/toolu_01ABC`);
    expect(describeNotice(message).options.tag).toBe(`${PROJECT}/event/mini/${SESSION}/42`);
  });

  it('bounds an alias that is too long for a title', () => {
    const title = describeNotice({ ...question, alias: 'x'.repeat(200) }).title;
    expect(title.length).toBeLessThan(100);
    expect(title).toMatch(/^x+… has a question$/);
  });

  it('draws a payload it cannot read as a plain prompt to open the desk', () => {
    const unknown = describeNotice(null);
    expect(unknown.title).toBe('The desk');
    expect(unknown.options.body).toBe('Something needs you. Open the desk to see it.');
    expect(unknown.options.data).toEqual({ url: '/' });
  });
});
