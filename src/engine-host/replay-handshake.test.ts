import { expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { appInitialize } from '@shared/engine/initialize';
import { loadJournal } from '../../test/support/fixtures';
import { appReplayHandshake } from './replay-handshake';
import { replayEngine } from './replay-transport';

it('projects only app-owned handshake fields, without changing the recorded journal or other controls', () => {
  const rows = loadJournal('pass3', 'mods-surface-invalidate');
  const before = JSON.stringify(rows);
  const trust = { accepted: true as const, directory: '/tmp/this-launch' };
  const projected = appReplayHandshake(rows, trust);
  for (let i = 0; i < rows.length; i++) {
    const original = rows[i]!;
    const frame = original.frame as { type?: string; request?: Record<string, unknown> };
    if (original.direction !== 'out' || frame.request?.subtype !== 'initialize') {
      expect(projected[i]).toBe(original);
      continue;
    }
    const request = { ...frame.request, ...appInitialize(trust) };
    expect(projected[i]).toEqual({ ...original, frame: { ...frame, request } });
  }
  expect(JSON.stringify(rows)).toBe(before);
});

it.each(['trust', 'capabilities', 'hooks'])('an app handshake projection does not excuse a wrong %s payload', async (changed) => {
  const trust = { accepted: true as const, directory: '/tmp/this-launch' };
  const hooks = { SessionStart: [{ hookCallbackIds: ['hook-1'] }] };
  const row: JournalRow = { seq: 1, direction: 'out', at: '2026-10-04T00:00:00.000Z', frame: { type: 'control_request', request_id: 'recorded', request: { subtype: 'initialize', hooks } } };
  const transport = replayEngine(appReplayHandshake([row], trust), { prelude: [] });
  const request = { subtype: 'initialize', ...appInitialize(trust), hooks };
  if (changed === 'trust') request.workspaceTrust = { accepted: true, directory: '/tmp/wrong-launch' };
  if (changed === 'capabilities') request.perTaskStopAffordance = false;
  if (changed === 'hooks') request.hooks = { SessionStart: [{ hookCallbackIds: ['wrong-hook'] }] };
  const write = transport.write({ type: 'control_request', request_id: 'minted', request } as StdinFrame);
  const next = await transport.frames[Symbol.asyncIterator]().next();
  expect(next.value.error.kind).toBe('replay_mismatch');
  await expect(write).rejects.toThrow('replay mismatch');
});
