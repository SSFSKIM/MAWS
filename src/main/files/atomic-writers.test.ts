import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveTextFile } from './save-text';
import { openSettingsStore } from '../settings/store';
import { LayoutFileStore } from '../layout/store';
import { writeWhole } from '../sessions/json-files';
import { FileAttentionStore } from '../attention/file-attention-store';
import type { AppSessionId } from '@shared/graph/ids';

vi.mock('node:crypto', async (original) => ({ ...await original<typeof import('node:crypto')>(), randomUUID: () => 'fixed-random-id' }));
vi.mock('../ipc/router', () => ({ registerMainHandler: vi.fn(), CommandFailure: Error }));
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'maws-atomic-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it.each(['export', 'settings', 'layout', 'sessions', 'attention'])('%s never follows or removes a pre-created temporary symlink', async (writer) => {
  const parent = join(dir, 'chosen');
  mkdirSync(parent);
  const victim = join(dir, 'unrelated.txt');
  writeFileSync(victim, 'keep me');
  const file = join(parent, 'target.json');
  const traps = [join(parent, `.target.json.${process.pid}.tmp`), `${file}.${process.pid}.tmp`, join(parent, '.target.fixed-random-id.tmp'), join(parent, '.target.json.fixed-random-id.tmp')];
  for (const trap of traps) symlinkSync(victim, trap);
  try {
    if (writer === 'export') await saveTextFile({ defaultName: 'target.json', text: 'replacement' }, { downloads: parent, showSaveDialog: async () => ({ canceled: false, filePath: file }) });
    if (writer === 'settings') openSettingsStore(file).update({ theme: 'dark' });
    if (writer === 'layout') new LayoutFileStore(file).set('regions', { width: 240 });
    if (writer === 'sessions') await writeWhole(parent, 'target', { changed: true });
    if (writer === 'attention') await new FileAttentionStore(file).retireForSession('app-1' as AppSessionId);
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe('EEXIST');
  }
  expect(readFileSync(victim, 'utf8')).toBe('keep me');
  for (const trap of traps) expect(lstatSync(trap).isSymbolicLink()).toBe(true);
});
