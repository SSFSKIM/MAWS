import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { trashFor } from './e2e-trash';

describe('e2e trash seam', () => {
  const dirs: string[] = [];
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-e2e-trash-test-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  const real = async (path: string) => void (realCalls.push(path));
  let realCalls: string[] = [];

  it('is the real Trash unless MAWS_E2E=1 and MAWS_E2E_TRASH_DIR are both set', () => {
    realCalls = [];
    const dir = temp();
    expect(trashFor({ MAWS_E2E_TRASH_DIR: dir }, real)).toBe(real);
    expect(trashFor({ MAWS_E2E: '1' }, real)).toBe(real);
    expect(trashFor({ MAWS_E2E: '1', MAWS_E2E_TRASH_DIR: dir }, real)).not.toBe(real);
  });

  it('moves files and directories into the directory, keeping names and never overwriting', async () => {
    realCalls = [];
    const store = temp();
    const trash = temp();
    const move = trashFor({ MAWS_E2E: '1', MAWS_E2E_TRASH_DIR: trash }, real);
    writeFileSync(join(store, 'a.jsonl'), 'one');
    mkdirSync(join(store, 'sidecar', 'subagents'), { recursive: true });
    await move(join(store, 'a.jsonl'));
    await move(join(store, 'sidecar'));
    writeFileSync(join(store, 'a.jsonl'), 'two');
    await move(join(store, 'a.jsonl'));
    expect(existsSync(join(store, 'a.jsonl'))).toBe(false);
    expect(readFileSync(join(trash, 'a.jsonl'), 'utf8')).toBe('one');
    expect(readFileSync(join(trash, 'a.jsonl.1'), 'utf8')).toBe('two');
    expect(existsSync(join(trash, 'sidecar', 'subagents'))).toBe(true);
    expect(realCalls).toEqual([]);
  });

  it('refuses a move when the directory does not exist, touching nothing', async () => {
    const store = temp();
    writeFileSync(join(store, 'a.jsonl'), 'one');
    const move = trashFor({ MAWS_E2E: '1', MAWS_E2E_TRASH_DIR: join(store, 'missing') }, real);
    await expect(move(join(store, 'a.jsonl'))).rejects.toThrow(/MAWS_E2E_TRASH_DIR is not a directory/);
    expect(existsSync(join(store, 'a.jsonl'))).toBe(true);
  });
});
