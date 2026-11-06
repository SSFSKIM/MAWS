// A channel entry's id as it leaves the endpoint (P5 O8 M7b fix wave, R5): an opaque cursor sealed under a key of the
// endpoint's own state, never the journal's table-wide id, so a member learns neither the gaps between entries nor
// whether an id they never saw exists. The same entry always seals to the same cursor (a device dedupes by it, across
// restarts), and a cursor opens only for the project it was sealed in.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostEntry } from '@shared/ipc/schema/channel';
import { ChannelCursors } from '../../src/endpoint/channel-cursors';

const dirs: string[] = [];
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), 'channel-cursors-'));
  dirs.push(path);
  return path;
};
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

const entry = (id: string, fields: Partial<HostEntry> = {}): HostEntry => ({
  id,
  project: 'proj-1',
  appSessionId: 'app-1' as never,
  engineSessionId: 'eng-1' as never,
  lane: 'B',
  kind: 'message',
  text: 'hello',
  at: '2026-11-06T10:00:00.000Z',
  src: `proj-1/lane-b/app-1/${id}`,
  ...fields,
});

describe('channel cursors', () => {
  it('seals an entry’s id into an opaque cursor that opens back to the id and its session, for its own project alone', () => {
    const cursors = new ChannelCursors(dir);
    const cursor = cursors.seal(entry('41'));
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(Buffer.from(cursor, 'base64url').toString('latin1')).not.toContain('41\nB\napp-1');
    expect(cursors.open(cursor, 'proj-1')).toEqual({ id: '41', lane: 'B', session: 'app-1' });
    expect(cursors.seal(entry('7', { lane: 'A', appSessionId: null, engineSessionId: 'la-2' as never }))).not.toBe(cursor);
    expect(cursors.open(cursors.seal(entry('7', { lane: 'A', appSessionId: null, engineSessionId: 'la-2' as never })), 'proj-1')).toEqual({ id: '7', lane: 'A', session: 'la-2' });
    expect(cursors.open(cursor, 'proj-2')).toBeNull();
  });

  it('seals one entry to one cursor, under a key kept 0600 in the endpoint’s state across restarts', () => {
    const state = dir();
    const first = new ChannelCursors(() => state).seal(entry('41'));
    expect(new ChannelCursors(() => state).seal(entry('41'))).toBe(first);
    expect(statSync(join(state, 'cursor-key')).mode & 0o777).toBe(0o600);
    // Another endpoint's key: its cursors open nothing here.
    expect(new ChannelCursors(dir).open(first, 'proj-1')).toBeNull();
  });

  it('opens nothing it did not seal: an id, a tampered cursor, a truncated one, garbage', () => {
    const cursors = new ChannelCursors(dir);
    const cursor = cursors.seal(entry('41'));
    const flipped = `${cursor.slice(0, 20)}${cursor[20] === 'A' ? 'B' : 'A'}${cursor.slice(21)}`;
    for (const token of ['41', flipped, cursor.slice(0, -4), '', 'not a cursor!', 'A'.repeat(4096)]) expect(cursors.open(token, 'proj-1'), token.slice(0, 40)).toBeNull();
  });
});
