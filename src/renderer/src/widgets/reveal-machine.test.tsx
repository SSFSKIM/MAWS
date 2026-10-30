// P5 O6 M4 (the task review): a widget's Reveal shows a path the session's machine answered, so it reveals there.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { preloadOf } from '../test-support/preload-of';
import { ConfigBody } from './ConfigWidget';
import { MemoryBody } from './MemoryWidget';

afterEach(cleanup);

it('reveals a memory file on the session’s machine', () => {
  const fake = fakeClient({ 'settings.reveal': { revealed: true } });
  window.maws = preloadOf(fake);
  const appSessionId = addressOf(OTHER_MACHINE, 'session-b' as AppSessionId);
  render(<MemoryBody appSessionId={appSessionId} close={() => {}} view={{ files: [{ label: 'Memory', path: '/same/CLAUDE.md', description: '', exists: true, note: null }], folders: [], autoMemory: null }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
  expect(fake.machines('settings.reveal')).toEqual([OTHER_MACHINE]);
});

it('opens a settings source file on the session’s machine', () => {
  const fake = fakeClient({ 'settings.reveal': { revealed: true } });
  window.maws = preloadOf(fake);
  render(<ConfigBody machine={OTHER_MACHINE} cwd="/work/b" configHome={null} close={() => {}} view={{ effective: [], sources: [{ source: 'projectSettings', label: 'Project', keys: [] }], applied: [], errors: [] }} />);
  fireEvent.click(screen.getByTitle('/work/b/.claude/settings.json'));
  expect(fake.machines('settings.reveal')).toEqual([OTHER_MACHINE]);
});
