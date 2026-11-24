// X2 `sheet.*` (the question sheet's C3, M2; docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §D): what
// crosses the wire is what the service answers, every session is named in the engine's id form, and the event reaches
// a window of this machine and no linked machine's.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MACHINE_EVENTS } from '../schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '../validate';
import { commands, events } from './sheet';

const FIXTURES = join(__dirname, '../../../../test/fixtures/sheet/set/fixtures');
const SESSION = '5eed0000-0000-4000-8000-000000000004';
const summary = { session: SESSION, appSessionId: null, title: null, live: null, seq: 2, open: 1, queued: 0, pending: 0, hidden: 0, oldestAskedAt: '2026-11-23T09:59:00.000Z', unreadable: false };

describe('the sheet namespace on the wire', () => {
  it('is the machine’s, five commands and one event, and the event is among the machine host’s', () => {
    expect(Object.fromEntries(Object.entries(commands).map(([name, spec]) => [name, spec.owner]))).toEqual({
      'sheet.list': 'machine', 'sheet.read': 'machine', 'sheet.put': 'machine', 'sheet.body': 'machine', 'sheet.upload': 'machine',
    });
    expect(Object.keys(events)).toEqual(['sheet.changed']);
    expect(MACHINE_EVENTS).toContain('sheet.changed');
  });

  it('names a session only in the engine’s id form', () => {
    for (const session of ['..', 'a/b', SESSION.toUpperCase(), `${SESSION}\n`, 'app-1', '']) {
      expect(validateCommandInput('sheet.read', { session }).ok, session).toBe(false);
      expect(validateCommandInput('sheet.body', { session, of: { ref: 'a'.repeat(64) } }).ok, session).toBe(false);
      expect(validateCommandInput('sheet.upload', { session, mediaType: 'image/png', data: '' }).ok, session).toBe(false);
      expect(validateCommandInput('sheet.put', { session, lines: [] }).ok, session).toBe(false);
    }
    expect(validateCommandInput('sheet.read', { session: SESSION }).ok).toBe(true);
  });

  it('takes a body request by hash or by an upload’s path with no separator, and no image type but the four', () => {
    expect(validateCommandInput('sheet.body', { session: SESSION, of: { upload: 'uploads/a.png' } }).ok).toBe(true);
    expect(validateCommandInput('sheet.body', { session: SESSION, of: { upload: 'uploads/../state.json' } }).ok).toBe(false);
    expect(validateCommandInput('sheet.body', { session: SESSION, of: { upload: 'refs/a.png' } }).ok).toBe(false);
    expect(validateCommandInput('sheet.upload', { session: SESSION, mediaType: 'image/svg+xml', data: '' }).ok).toBe(false);
  });

  it('carries any count of lines to the service, which answers a refusal (no bound here)', () => {
    const line = (i: number) => ({ v: 1, key: `maws-${String(i).padStart(8, '0')}`, kind: 'dismiss', id: 'q1', by: 'maws' });
    expect(validateCommandInput('sheet.put', { session: SESSION, lines: Array.from({ length: 51 }, (_, i) => line(i)) }).ok).toBe(true);
    expect(validateCommandInput('sheet.put', { session: SESSION, lines: [{ ...line(1), at: '2026-11-23T10:00:00.000Z' }] }).ok, 'a surface writes no `at`').toBe(false);
  });

  it('answers every model of the pin, the door’s three states, and the door’s results and refusals', () => {
    const doors = [{ known: false }, { known: true, available: true }, { known: true, available: false, reason: 'No sminos is installed.' }];
    for (const door of doors) expect(validateCommandOutput('sheet.list', { sessions: [summary], door }).ok, JSON.stringify(door)).toBe(true);
    expect(validateCommandOutput('sheet.list', { sessions: [], door: { known: true } }).ok).toBe(false);
    for (const name of readdirSync(FIXTURES)) {
      for (const side of ['before', 'after']) {
        const model = JSON.parse(readFileSync(join(FIXTURES, name, `show.${side}.json`), 'utf8')) as unknown;
        expect(validateCommandOutput('sheet.read', { model, door: { known: false } }).ok, `${name} ${side}`).toBe(true);
      }
    }
    expect(validateCommandOutput('sheet.put', { ok: true, results: [{ key: 'maws-00000001', state: 'queued' }, { key: 'maws-00000002', state: 'applied', kind: 'answer', at: '2026-11-23T10:00:00.000Z', verdict: 'applied' }] }).ok).toBe(true);
    expect(validateCommandOutput('sheet.put', { ok: false, why: 'busy', message: 'The sheet was busy; send again.' }).ok).toBe(true);
    expect(validateCommandOutput('sheet.body', { kind: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' }).ok).toBe(true);
    expect(validateCommandOutput('sheet.body', { kind: 'image', mediaType: 'image/svg+xml', data: '' }).ok).toBe(false);
    expect(validateCommandOutput('sheet.upload', { ok: true, path: 'uploads/maws-0.png' }).ok).toBe(true);
    expect(validateEventPayload('sheet.changed', { session: SESSION, summary }).ok).toBe(true);
    expect(validateEventPayload('sheet.changed', { session: SESSION, summary: null }).ok).toBe(true);
  });
});
