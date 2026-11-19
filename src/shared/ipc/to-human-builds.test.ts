// What the UX wave's U2b sends that the two earlier builds on the owner's machines can meet (docs/doperpowers/plans/
// 2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §F; the root's UC-14). Two optional keys, the owner channel
// lane's `drawnBy` and the to-human mods row's `summaries`: a build that does not know them drops the key with the
// tolerant reader and keeps the rest, and this build reads their values, which never carry them. Three commands in the
// same minor, `session.ui.renderSite`, `ownerChannel.folds` and `mods.setFoldSummaries`: a host or a daemon of an
// earlier build answers each with `unknown_command`.
import * as z from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AppSessionIdSchema } from '../graph/ids';
import { createHostRuntime, type HostPort } from '../host/runtime';
import { ModRowSchema } from '../mods/registry';
import { ContractSourceSchema, LanePendingSchema, LaneOverrideSchema, OwnerChannelStateSchema, OwnerMarkSchema, StyleMismatchSchema } from '../owner/state';
import { REGISTRY } from './registry';
import { commands, events } from './schema';
import { readTolerant } from './tolerant';

// The state and the row as build F (`f1852de3a`) and the installed build (`2c7044231`) have them, copied literally:
// `src/shared/owner/state.ts`, `src/shared/mods/registry.ts` and `ipc/tolerant.ts` are the same text at both and at
// this landing's base, so each copy is both builds' own schema.
const EARLIER_STATE = z.strictObject({
  appSessionId: AppSessionIdSchema,
  lane: z.strictObject({
    on: z.boolean(),
    override: LaneOverrideSchema,
    applied: ContractSourceSchema.nullable(),
    pending: LanePendingSchema.nullable(),
    mismatch: StyleMismatchSchema.nullable(),
  }),
  marks: z.array(OwnerMarkSchema),
});
const EARLIER_ROW = z.strictObject({
  id: z.enum(['maws.to-human']),
  name: z.string(),
  description: z.string(),
  version: z.number().int(),
  enabled: z.boolean(),
  source: ContractSourceSchema,
  perSession: LaneOverrideSchema.optional(),
  pending: LanePendingSchema.optional(),
  mismatch: StyleMismatchSchema.optional(),
});

const lane = { on: true, override: 'inherit', applied: 'external-style-plus-supplement', pending: null, mismatch: null } as const;
const state = (over: Record<string, unknown> = {}) => ({ appSessionId: 'app-1', lane: { ...lane, ...over }, marks: [] });
const row = (over: Record<string, unknown> = {}) => ({ id: 'maws.to-human', name: 'To-human', description: 'Agents send you messages.', version: 9, enabled: true, source: 'external-style-plus-supplement', ...over });

describe('the owner channel lane’s drawnBy, between builds', () => {
  it('an earlier build reads this build’s state, on the command and on the event, with the key dropped', () => {
    for (const drawnBy of ['mod', 'maws']) {
      const sent = state({ drawnBy });
      expect(EARLIER_STATE.safeParse(sent).success).toBe(false); // strict: refused outright without the tolerant reader
      expect(readTolerant(EARLIER_STATE, sent)).toEqual({ ok: true, value: state(), dropped: ['lane.drawnBy'] });
      const changed = z.strictObject({ appSessionId: AppSessionIdSchema, state: EARLIER_STATE });
      expect(readTolerant(changed, { appSessionId: 'app-1', state: sent })).toEqual({ ok: true, value: { appSessionId: 'app-1', state: state() }, dropped: ['state.lane.drawnBy'] });
    }
  });

  it('this build carries it, reads an earlier state without it, and refuses any other value', () => {
    expect(OwnerChannelStateSchema.parse(state({ drawnBy: 'mod' }))).toEqual(state({ drawnBy: 'mod' }));
    expect(OwnerChannelStateSchema.parse(state())).toEqual(state());
    expect(OwnerChannelStateSchema.safeParse(state({ drawnBy: 'both' })).success).toBe(false);
    expect(commands['ownerChannel.state'].output.parse(state({ drawnBy: 'maws' }))).toEqual(state({ drawnBy: 'maws' }));
    expect(events['ownerChannel.changed'].parse({ appSessionId: 'app-1', state: state({ drawnBy: 'mod' }) })).toEqual({ appSessionId: 'app-1', state: state({ drawnBy: 'mod' }) });
  });
});

describe('the to-human row’s summaries, between builds', () => {
  it('an earlier build reads this build’s mods list with the key dropped, and draws no switch', () => {
    const sent = [row({ summaries: false, perSession: 'inherit' })];
    expect(z.array(EARLIER_ROW).safeParse(sent).success).toBe(false);
    expect(readTolerant(z.array(EARLIER_ROW), sent)).toEqual({ ok: true, value: [row({ perSession: 'inherit' })], dropped: ['0.summaries'] });
  });

  it('this build carries it, and reads an earlier daemon’s row without it', () => {
    expect(ModRowSchema.parse(row({ summaries: true }))).toEqual(row({ summaries: true }));
    expect(ModRowSchema.parse(row())).toEqual(row());
    expect(ModRowSchema.safeParse(row({ summaries: 'off' })).success).toBe(false);
  });
});

describe('the three commands of the minor', () => {
  const ADDED = ['session.ui.renderSite', 'ownerChannel.folds', 'mods.setFoldSummaries'] as const;
  // An earlier build's registry: this one without the three commands (everything else of theirs is unchanged in name)
  const earlier = { ...REGISTRY, commands: Object.fromEntries(Object.entries(REGISTRY.commands).filter(([name]) => !(ADDED as readonly string[]).includes(name))) } as typeof REGISTRY;

  function fakePort() {
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const posted: unknown[] = [];
    const port: HostPort = { on: (_event, listener) => void listeners.push(listener), postMessage: (message) => void posted.push(message), start: vi.fn() };
    return { port, posted, deliver: async (data: unknown) => (listeners.forEach((l) => l({ data })), await new Promise((resolve) => setTimeout(resolve, 0))) };
  }

  it('are this build’s, owned where their siblings are', () => {
    expect(ADDED.map((name) => [name, REGISTRY.commands[name].owner])).toEqual([['session.ui.renderSite', 'engine-host'], ['ownerChannel.folds', 'machine'], ['mods.setFoldSummaries', 'machine']]);
  });

  it('an earlier host or daemon answers each with unknown_command', async () => {
    const fake = fakePort();
    createHostRuntime(() => {}, { registry: earlier }).serve(fake.port);
    const inputs = {
      'session.ui.renderSite': { appSessionId: 'app-1', component: 'TurnDuration', instanceId: 'u1~turn', props: { word: 'Worked', durationMs: 1200, isExpanded: true } },
      'ownerChannel.folds': { appSessionId: 'app-1' },
      'mods.setFoldSummaries': { on: false },
    };
    for (const [n, name] of ADDED.entries()) await fake.deliver({ t: 'req', id: String(n), name, input: inputs[name] });
    expect(fake.posted).toEqual(ADDED.map((_, n) => ({ t: 'res', id: String(n), ok: false, error: expect.objectContaining({ code: 'unknown_command' }) })));
  });
});
