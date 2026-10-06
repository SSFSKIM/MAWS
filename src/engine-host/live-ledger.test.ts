import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLive, readLive, writeLive } from './live-ledger';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-live-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const OWNER = { pid: 500, procStart: 'T500' };
const ROW = { appSessionId: 'app-1', pid: 600, procStart: 'T600', launchId: 'L1' };

describe('the orphan ledger', () => {
  it('writes its owner and rows through a temporary file and a rename', () => {
    writeLive(dir, OWNER, [ROW]);
    expect(JSON.parse(readFileSync(join(dir, 'live.json'), 'utf8'))).toEqual({ owner: OWNER, rows: [ROW] });
    writeLive(dir, OWNER, []);
    expect(readLive(dir)).toEqual({ owner: OWNER, rows: [] });
    expect(readdirSync(dir)).toEqual(['live.json']);
  });

  it('clearLive removes the ledger only when this owner wrote it', () => {
    writeLive(dir, { pid: 501, procStart: 'T501' }, [ROW]); // a successor's
    clearLive(dir, OWNER);
    expect(readLive(dir)?.owner.pid).toBe(501);
    clearLive(dir, { pid: 501, procStart: 'other start' }); // the same pid, another process
    expect(readLive(dir)?.owner.pid).toBe(501);
    clearLive(dir, { pid: 501, procStart: 'T501' });
    expect(readLive(dir)).toBeNull();
    expect(() => clearLive(dir, OWNER)).not.toThrow(); // nothing to clear
  });

  it('reads an unreadable ledger as none', () => {
    writeFileSync(join(dir, 'live.json'), '{"owner":');
    expect(readLive(dir)).toBeNull();
    clearLive(dir, OWNER);
    expect(readdirSync(dir)).toEqual(['live.json']); // not ours to remove
  });
});
