// The project's audit record as the owner reads it: the hub replays it on every connect, so each line names when and
// about which machine, and a stream's `not-open` handshake, which its uplink heals by itself, is not shown as a refusal.
import { describe, expect, it } from 'vitest';
import { dateFormats } from '@shared/app/date-format';
import { auditText, auditWhen, shownAudit } from './audit';
import type { AuditItem } from './connection';

const ME = '0b1c2d3e4f504617a293a4b5c6d7e8f9';
const refused = (id: number, over: Partial<Extract<AuditItem, { kind: 'refused' }>['entry']>): AuditItem => ({
  kind: 'refused',
  entry: { id, at: '2026-10-19T12:49:50.000Z', reason: 'gap', message: 'a seq not one past the writer’s last', ...over },
});
const notOpen = (id: number): AuditItem => refused(id, { reason: 'not-open', machine: 'macbook', message: 'send hello for this project on this stream first' });

describe('shownAudit', () => {
  it('leaves out a stream’s not-open handshake and keeps every other refusal and rejection, in order', () => {
    const gap = refused(2, { machine: 'mini', writer: 'mini/s1', seq: 9 });
    const rejected: AuditItem = { kind: 'rejected', entry: { id: 4, at: '2026-10-19T12:50:00.000Z', machine: 'mini', event: { writer: 'SK.local/human', seq: 7 }, reason: 'seen-nonce' } };
    const browser = refused(5, { reason: 'bad-shape', member: ME, message: 'rows is {sub, before, limit}' });
    expect(shownAudit([notOpen(1), gap, notOpen(3), rejected, browser])).toEqual([gap, rejected, browser]);
    expect(shownAudit([notOpen(1), notOpen(3)])).toEqual([]);
  });
});

describe('auditText', () => {
  it('names the machine the hub refused, or the member whose browser it refused, never "a request"', () => {
    expect(auditText(refused(1, { machine: 'mini', writer: 'mini/s1', seq: 9 }), ME)).toBe('The hub refused mini/s1:9 from mini (gap): a seq not one past the writer’s last');
    expect(auditText(refused(1, { reason: 'stale-generation', machine: 'macbook', message: 'a newer stream of this machine is open' }), ME)).toBe(
      'The hub refused what macbook sent (stale-generation): a newer stream of this machine is open',
    );
    expect(auditText(refused(1, { reason: 'bad-shape', member: ME, message: 'no frame "x"' }), ME)).toBe('The hub refused what you sent (bad-shape): no frame "x"');
    expect(auditText(refused(1, { reason: 'bad-shape', member: '9a8b7c6d5e4f432187650fedcba98765', message: 'm' }), ME)).toBe('The hub refused what another member (9a8b7c6d) sent (bad-shape): m');
    expect(auditText(refused(1, { reason: 'conflict', message: 'this nonce was sent with another payload' }), ME)).toBe('The hub refused what it was sent (conflict): this nonce was sent with another payload');
  });

  it('names the machine that refused an event it was sent', () => {
    const rejected: AuditItem = { kind: 'rejected', entry: { id: 1, at: '2026-10-19T12:50:00.000Z', machine: 'mini', event: { writer: 'SK.local/human', seq: 7 }, reason: 'seen-nonce', message: 'a nonce this machine has seen' } };
    expect(auditText(rejected, ME)).toBe('mini refused SK.local/human:7 (seen-nonce): a nonce this machine has seen');
    expect(auditText({ kind: 'rejected', entry: { id: 2, at: '2026-10-19T12:50:00.000Z', machine: 'mini', event: null, reason: 'bad-shape' } }, ME)).toBe('mini refused an event (bad-shape)');
  });
});

describe('auditWhen', () => {
  const en = dateFormats('en-US');
  it('says the clock time of one recorded today and the date as well of an older one, the whole of it for a title', () => {
    const at = new Date(2026, 9, 19, 14, 5).toISOString();
    const today = auditWhen(at, new Date(2026, 9, 19, 18, 0).getTime(), en);
    expect(today.when).toBe('2:05 PM');
    expect(today.title).toBe('Oct 19, 2026, 2:05 PM');
    expect(auditWhen(at, new Date(2026, 9, 20, 9, 0).getTime(), en).when).toBe('Oct 19, 2026, 2:05 PM');
    expect(auditWhen('not a time', Date.now(), en)).toEqual({ when: 'at a time it did not record', title: '' });
  });
});
