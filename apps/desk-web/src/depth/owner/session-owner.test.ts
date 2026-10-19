// @vitest-environment happy-dom
// The per-session owner (DC9's M3, §9.1 "The subscription moves"): one main transcript per (machine, session) that the
// center's session view and the depth column share while either holds it — opened at the first hold, closed and its
// store key dropped at the last release — with the open-agent request and the session's liveness on it.
import { act, cleanup, renderHook } from '@testing-library/react';
import type { SubagentMeta } from 'desk-hub/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscriptStore, useTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { SubagentRef } from '../../../../../src/renderer/src/transcript/model/rows';
import { FakePlane, mount, settle } from '../../../test/double/fake-plane';
import { readRecording, scriptOf } from '../../../test/double/session-stream';
import type { DeskSession } from '../../shell/sessions';
import { learnServed, transcriptServed } from '../../shell/transcript-served';
import { holdOwner, sessionOwner, useSessionOwner } from './session-owner';

const recording = readRecording();
const metas: SubagentMeta[] = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
const script = scriptOf(recording.session, null);

const session = (over: Partial<DeskSession> = {}): DeskSession =>
  ({
    project: 'proj',
    session: 'sess-1',
    alias: 'maws-45',
    machine: 'mini',
    cwd: null,
    worktree: null,
    seat: '',
    title: null,
    member: true,
    ended: null,
    charge: null,
    status: null,
    state: null,
    joinedAt: 0,
    group: 'working',
    presence: { record: { status: 'busy' }, bridge: true },
    machineOnline: true,
    ...over,
  }) as DeskSession;

afterEach(() => cleanup());

describe('the per-session owner', () => {
  it('two holders share one subscription; the last release closes it and drops the store key', async () => {
    const plane = new FakePlane('proj', metas);
    const store = createTranscriptStore();
    const where = { project: 'proj', machine: 'mini', session: 'sess-1', plane, store };
    const owner = sessionOwner(where);
    expect(sessionOwner(where)).toBe(owner); // the column and the center ask for the same one
    expect(plane.subs).toHaveLength(0); // opened at the first hold, not before

    const releaseCenter = holdOwner(owner);
    const releaseColumn = holdOwner(owner);
    expect(plane.subs).toHaveLength(1);
    const unmount = mount(owner.main, store);
    plane.snapshot(script, 6);
    await settle();
    expect(store.getState().entries[owner.main.key]?.rows.length).toBeGreaterThan(0);

    releaseCenter();
    await settle();
    expect(plane.current.closed).toBe(false); // the column still holds it
    expect(store.getState().entries[owner.main.key]).toBeDefined();

    unmount();
    releaseColumn();
    await settle();
    expect(plane.current.closed).toBe(true);
    expect(store.getState().entries[owner.main.key]).toBeUndefined();
    expect(sessionOwner(where)).not.toBe(owner); // a later view starts a fresh one
  });

  it('a view handing the owner to another in one pass (a release and a hold together) keeps its one subscription', async () => {
    const plane = new FakePlane('proj', metas);
    const where = { project: 'proj', machine: 'mini', session: 'sess-1', plane, store: createTranscriptStore() };
    const owner = sessionOwner(where);
    const release = holdOwner(owner);
    release();
    const again = holdOwner(owner);
    await settle();
    expect(plane.subs).toHaveLength(1);
    expect(plane.current.closed).toBe(false);
    expect(sessionOwner(where)).toBe(owner);
    again();
    await settle();
    expect(plane.current.closed).toBe(true);
  });

  it('a session on another machine, or another session, has an owner of its own', () => {
    const plane = new FakePlane('proj');
    const store = createTranscriptStore();
    const a = sessionOwner({ project: 'proj', machine: 'mini', session: 'sess-1', plane, store });
    expect(sessionOwner({ project: 'proj', machine: 'mini', session: 'sess-2', plane, store })).not.toBe(a);
    expect(sessionOwner({ project: 'proj', machine: 'SK.local', session: 'sess-1', plane, store })).not.toBe(a);
  });

  it("holds through the hook: two views, one subscription, the session's liveness told once to the store", async () => {
    const plane = new FakePlane('proj', metas);
    const center = renderHook(({ s }) => useSessionOwner('proj', s, plane), { initialProps: { s: session() } });
    const column = renderHook(({ s }) => useSessionOwner('proj', s, plane), { initialProps: { s: session() } });
    expect(column.result.current).toBe(center.result.current);
    expect(plane.subs).toHaveLength(1);
    const key = center.result.current.main.key;
    expect(useTranscriptStore.getState().live[key]).toBe(true);

    // The session ends: its liveness is read from presence, and the subscription stays (an ended session pages).
    center.rerender({ s: session({ presence: { record: null, bridge: false }, group: 'ended' }) });
    column.rerender({ s: session({ presence: { record: null, bridge: false }, group: 'ended' }) });
    expect(useTranscriptStore.getState().live[key]).toBe(false);
    expect(plane.current.closed).toBe(false);

    center.unmount();
    await act(settle);
    expect(plane.current.closed).toBe(false);
    expect(useTranscriptStore.getState().live[key]).toBe(false);
    column.unmount();
    await act(settle);
    expect(plane.current.closed).toBe(true);
    expect(key in useTranscriptStore.getState().live).toBe(false);
  });
});

describe('whether the machine serves the transcript (what Resume waits on)', () => {
  const where = { project: 'proj', machine: 'mini', session: 'sess-1' };

  it('is not known until the subscription says; a snapshot of rows says it is served, through a later disruption, until the last release', async () => {
    const plane = new FakePlane('proj', metas);
    const owner = sessionOwner({ ...where, plane, store: createTranscriptStore() });
    const release = holdOwner(owner);
    expect(transcriptServed(where)).toBeNull(); // subscribed, nothing answered yet
    plane.snapshot(script, 6);
    expect(transcriptServed(where)).toBe('served');
    plane.current.listener.end({ reason: 'machine-offline' });
    expect(transcriptServed(where)).toBe('served'); // the machine went away; the transcript it served did not
    release();
    await settle();
    expect(transcriptServed(where)).toBeNull(); // forgotten with the subscription: a later view learns it anew
  });

  it("is none once the machine ends the subscription at n 0 with session-ended, held through a retry until a snapshot comes", async () => {
    const plane = new FakePlane('proj', metas);
    const owner = sessionOwner({ ...where, plane, store: createTranscriptStore() });
    const release = holdOwner(owner);
    plane.current.listener.end({ reason: 'session-ended' });
    expect(transcriptServed(where)).toBe('none');
    owner.main.resubscribe();
    expect(owner.main.state.getState().phase).toBe('loading');
    expect(transcriptServed(where)).toBe('none'); // a retry under way does not flicker back to not known
    plane.snapshot(script, 6);
    expect(transcriptServed(where)).toBe('served');
    release();
    await settle();
  });

  it('an empty snapshot says neither: the plane sends one for a running session whose transcript it cannot find; rows that follow it say served', async () => {
    const plane = new FakePlane('proj', metas);
    const store = createTranscriptStore();
    const owner = sessionOwner({ ...where, plane, store });
    const release = holdOwner(owner);
    const unmount = mount(owner.main, store);
    plane.snapshot(script, 0);
    expect(owner.main.state.getState().phase).toBe('live');
    expect(transcriptServed(where)).toBeNull(); // so a session that ends with its view open is still not offered Resume
    plane.play(script.slice(0, script.findIndex((item) => item.kind === 'row') + 1));
    await settle();
    expect(transcriptServed(where)).toBe('served');
    unmount();
    release();
    await settle();
  });

  it("an owner living out its holds never erases what the session's current owner told", () => {
    const older = {};
    const current = {};
    learnServed(where, older, 'served');
    learnServed(where, current, 'none');
    learnServed(where, older, null);
    expect(transcriptServed(where)).toBe('none');
    learnServed(where, current, null);
    expect(transcriptServed(where)).toBeNull();
  });
});

describe('the open-agent request', () => {
  const agentRef = (over: Partial<SubagentRef>): SubagentRef => ({ kind: 'agent', taskId: '' as never, agentId: null, toolUseId: null, name: '', glyph: 0, subagentType: null, ...over });

  it("names the agent an Agent row opens, waiting for the column, which takes it once", async () => {
    const plane = new FakePlane('proj', metas);
    const owner = sessionOwner({ project: 'proj', machine: 'mini', session: 'sess-1', plane, store: createTranscriptStore() });
    const release = holdOwner(owner);
    plane.snapshot(script, script.length);
    const [first] = metas;
    owner.openSubagent(agentRef({ agentId: first.agentId as never }));
    expect(owner.takeAgentRequest()).toEqual({ agentId: first.agentId });
    expect(owner.takeAgentRequest()).toBeNull(); // taken: a column opened later does not jump to it again
    release();
  });

  it("resolves a row whose ref still holds its call's id through the tree, and asks for the tree when it cannot", async () => {
    const plane = new FakePlane('proj', metas);
    const owner = sessionOwner({ project: 'proj', machine: 'mini', session: 'sess-1', plane, store: createTranscriptStore() });
    const release = holdOwner(owner);
    plane.snapshot(script, script.length);
    const toolUseId = String(metas[0].meta.toolUseId);
    owner.openSubagent(agentRef({ taskId: toolUseId as never, toolUseId: toolUseId as never }));
    expect(owner.takeAgentRequest()).toEqual({ agentId: metas[0].agentId });
    owner.openSubagent(agentRef({ taskId: 'toolu_unknown' as never, toolUseId: 'toolu_unknown' as never }));
    expect(owner.takeAgentRequest()).toEqual({ agentId: null });
    owner.openSubagent(agentRef({ kind: 'workflow', taskId: 'wf-1' as never }));
    expect(owner.takeAgentRequest()).toBeNull(); // a workflow is not an agent of the tree
    release();
  });
});
