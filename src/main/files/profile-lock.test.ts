import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openSettingsStore } from '../settings/store';
import { startWithProfileLock, type LockingApp } from './profile-lock';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'maws-profile-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const BUILD = { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' };
const handoff = { build: BUILD, onSecondInstance: () => {} };
const on = () => {};

it('a second instance quits before any persisted store opens', async () => {
  const app = { requestSingleInstanceLock: () => false, hasSingleInstanceLock: () => false, whenReady: vi.fn(async () => {}), quit: vi.fn(), on };
  await startWithProfileLock(app, () => openSettingsStore(join(dir, 'settings.json')).update({ theme: 'dark' }), handoff);
  expect(app.quit).toHaveBeenCalledOnce();
  expect(app.whenReady).not.toHaveBeenCalled();
  expect(readdirSync(dir)).toEqual([]);
});

it('the primary opens stores only after readiness, with the lock still held', async () => {
  let ready!: () => void;
  let held = false;
  const app = { requestSingleInstanceLock: () => (held = true), hasSingleInstanceLock: () => held, whenReady: () => new Promise<void>((resolve) => { ready = resolve; }), quit: vi.fn(), on };
  const started = startWithProfileLock(app, () => openSettingsStore(join(dir, 'settings.json')).update({ theme: 'dark' }), handoff);
  expect(held).toBe(true);
  expect(readdirSync(dir)).toEqual([]);
  ready();
  await started;
  expect(openSettingsStore(join(dir, 'settings.json')).settings.theme).toBe('dark');
  expect(app.quit).not.toHaveBeenCalled();
});

it('refuses startup if the lock was released while waiting for readiness', async () => {
  const app = { requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => false, whenReady: async () => {}, quit: vi.fn(), on };
  await startWithProfileLock(app, () => openSettingsStore(join(dir, 'settings.json')).update({ theme: 'dark' }), handoff);
  expect(app.quit).toHaveBeenCalledOnce();
  expect(readdirSync(dir)).toEqual([]);
});

// E11 §2.7: a second launch hands its build to the running instance, which is told of it (to focus itself and, when it is
// the older build, say so) rather than the second launch exiting with no word.
it('a second launch hands its build to the running instance, which hears of every one', async () => {
  const asked: unknown[] = [];
  type Listener = Parameters<LockingApp['on']>[1];
  const listeners = new Map<string, Listener>();
  const secondary = { requestSingleInstanceLock: (data?: unknown) => (asked.push(data), false), hasSingleInstanceLock: () => false, whenReady: vi.fn(async () => {}), quit: vi.fn(), on };
  await startWithProfileLock(secondary, () => {}, handoff);
  expect(asked).toEqual([{ build: BUILD }]);
  expect(secondary.quit).toHaveBeenCalledOnce();

  const heard: unknown[] = [];
  const primary = { requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => true, whenReady: async () => {}, quit: vi.fn(), on: (name: string, listener: Listener) => void listeners.set(name, listener) };
  await startWithProfileLock(primary, () => {}, { build: BUILD, onSecondInstance: (launched) => heard.push(launched) });
  listeners.get('second-instance')!({}, ['/Applications/MAWS.app'], '/', { build: { ...BUILD, commit: 'newer000' } });
  listeners.get('second-instance')!({}, [], '/', undefined); // an older build passes nothing
  expect(heard).toEqual([{ ...BUILD, commit: 'newer000' }, null]);
});
