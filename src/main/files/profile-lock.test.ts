import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openSettingsStore } from '../settings/store';
import { startWithProfileLock } from './profile-lock';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'maws-profile-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('a second instance quits before any persisted store opens', async () => {
  const app = { requestSingleInstanceLock: () => false, hasSingleInstanceLock: () => false, whenReady: vi.fn(async () => {}), quit: vi.fn() };
  await startWithProfileLock(app, () => openSettingsStore(join(dir, 'settings.json')).update({ theme: 'dark' }));
  expect(app.quit).toHaveBeenCalledOnce();
  expect(app.whenReady).not.toHaveBeenCalled();
  expect(readdirSync(dir)).toEqual([]);
});

it('the primary opens stores only after readiness, with the lock still held', async () => {
  let ready!: () => void;
  let held = false;
  const app = { requestSingleInstanceLock: () => (held = true), hasSingleInstanceLock: () => held, whenReady: () => new Promise<void>((resolve) => { ready = resolve; }), quit: vi.fn() };
  const started = startWithProfileLock(app, () => openSettingsStore(join(dir, 'settings.json')).update({ theme: 'dark' }));
  expect(held).toBe(true);
  expect(readdirSync(dir)).toEqual([]);
  ready();
  await started;
  expect(openSettingsStore(join(dir, 'settings.json')).settings.theme).toBe('dark');
  expect(app.quit).not.toHaveBeenCalled();
});

it('refuses startup if the lock was released while waiting for readiness', async () => {
  const app = { requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => false, whenReady: async () => {}, quit: vi.fn() };
  await startWithProfileLock(app, () => openSettingsStore(join(dir, 'settings.json')).update({ theme: 'dark' }));
  expect(app.quit).toHaveBeenCalledOnce();
  expect(readdirSync(dir)).toEqual([]);
});
