// autoModeLane (C11 execution document, Interfaces "Session info tool", the lane paragraph and M4's pins): the lane is
// derived from the effective mode, the refusal, C3's current-turn observation, the model's gateway-ness, fast mode and
// the `Auto mode server` row, and an observation from an earlier turn never outlives it (compared on the EventId).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import type { EventId } from '@shared/graph/ids';
import { loadScenario } from '../../../../../test/support/scenario';
import { applyEvents, createState } from '../../transcript/model/reduce';
import { builder, tool } from '../../transcript/model/test-events';
import { autoModeLane, reviewsOf } from './lane';

const ROOT = join(__dirname, '../../../../..');
const base = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine.find((s) => s.process === 'ready')!;

const T12 = 'app-1:launch-1:12:0' as EventId;
const T40 = 'app-1:launch-1:40:0' as EventId;
const AT = '2026-09-29T10:00:00.000Z';
const turn = (id: EventId) => ({ id, origin: 'human' as const, startedAt: AT, acceptedAt: AT, userMessageUuids: [] });

interface Patch {
  model?: string;
  fast?: EngineSessionStatus['fastMode']['state'];
  server?: EngineSessionStatus['gateway']['autoModeServer'];
  localLane?: EventId | null;
  turn?: EventId | null;
  effective?: EngineSessionStatus['permissionMode']['effective'];
  refusal?: EngineSessionStatus['permissionMode']['refusal'];
}

// The pin's status: auto and effective, the server row enabled, no observation, Sonnet, fast mode off, no open turn.
function status(patch: Patch = {}): EngineSessionStatus {
  const effective = patch.effective ?? 'auto';
  return EngineSessionStatusSchema.parse({
    ...base,
    model: { requested: patch.model ?? 'claude-sonnet-5[1m]', resolved: patch.model ?? 'claude-sonnet-5[1m]' },
    fastMode: { state: patch.fast ?? 'off', disabledReason: null },
    permissionMode: { requested: patch.refusal ? 'auto' : effective, effective, refusal: patch.refusal ?? null },
    gateway: { ...base.gateway, autoModeServer: patch.server ?? 'enabled', localLane: patch.localLane ? { observedInTurn: patch.localLane, at: AT } : null },
    turn: patch.turn ? turn(patch.turn) : null,
  });
}

describe('autoModeLane derives the lane from status and model', () => {
  it('server for auto on Sonnet with the server row enabled and nothing observed', () => {
    const lane = autoModeLane(status(), null, null);
    expect(lane.kind).toBe('server');
    expect(lane.sentence).toBe('Server · reviews ride on the main request · no charge · model chosen server-side');
  });

  it('local (expected) on a gateway model or with fast mode on, even while the row reads enabled', () => {
    expect(autoModeLane(status({ model: 'claude/astra' }), null, null)).toMatchObject({ kind: 'local_expected', sentence: 'Local (expected) · a GPT route carries no Anthropic verdict' });
    expect(autoModeLane(status({ fast: 'on' }), null, null)).toMatchObject({ kind: 'local_expected', sentence: 'Local (expected) · fast mode is on' });
    // the catalogue entry's value decides when the status names another id
    expect(autoModeLane(status({ model: 'gpt-5.5' }), { value: 'claude/astra' }, null).kind).toBe('local_expected');
  });

  it('local (observed) only while the observation belongs to the open turn', () => {
    const lane = autoModeLane(status({ model: 'claude/astra', localLane: T12, turn: T12 }), null, null, '3@example.test');
    expect(lane).toMatchObject({ kind: 'local_observed', sentence: "Local · Sonnet 5 through 3@example.test · counted as usage · the engine's notice is in the transcript" });
  });

  it('unavailable with the refusal in words, off for any other mode', () => {
    expect(autoModeLane(status({ effective: 'default', refusal: 'auto_mode_fast_mode' }), null, null)).toMatchObject({ kind: 'unavailable', sentence: 'Auto mode is unavailable with fast mode' });
    expect(autoModeLane(status({ effective: 'default' }), null, null)).toMatchObject({ kind: 'off', sentence: 'Auto mode is off · Manual' });
  });

  it('GPT → Claude: the observation on astra reads local, and the next turn on Sonnet reads server', () => {
    expect(autoModeLane(status({ model: 'claude/astra', localLane: T12, turn: T12 }), null, null).kind).toBe('local_observed');
    expect(autoModeLane(status({ model: 'claude-sonnet-5[1m]', localLane: null, turn: null }), null, null).kind).toBe('server');
  });

  it('a stale observation from an earlier turn on Sonnet reads server, never local (observed); an equal startedAt changes nothing', () => {
    const stale = status({ localLane: T12, turn: T40 });
    expect(stale.turn!.startedAt).toBe(stale.gateway.localLane!.at); // the two share a time: the comparison is on the id
    expect(autoModeLane(stale, null, null).kind).toBe('server');
    expect(autoModeLane(status({ localLane: T12, turn: null }), null, null).kind).toBe('server');
  });

  it('a transient server fallback on Sonnet reads local (observed) in its turn and server again on the next', () => {
    expect(autoModeLane(status({ localLane: T40, turn: T40 }), null, null).kind).toBe('local_observed');
    expect(autoModeLane(status({ localLane: null, turn: 'app-1:launch-1:55:0' as EventId }), null, null).kind).toBe('server');
  });

  it('the server lane disabled reads local (expected) with its reason; an unread row reads Not read yet', () => {
    expect(autoModeLane(status({ server: 'disabled' }), null, null)).toMatchObject({ kind: 'local_expected', sentence: 'Local (expected) · the server lane is disabled for this session' });
    expect(autoModeLane(status({ server: 'unknown' }), null, null)).toMatchObject({ kind: 'unknown', sentence: 'Not read yet' });
  });

  it('carries the reviews it was given, never beside off or unavailable', () => {
    const reviews = { evaluated: 3, flagged: 1 };
    expect(autoModeLane(status(), null, reviews).reviews).toEqual(reviews);
    expect(autoModeLane(status({ model: 'claude/astra' }), null, reviews).reviews).toEqual(reviews);
    expect(autoModeLane(status({ effective: 'default' }), null, reviews)).toMatchObject({ kind: 'off', reviews: null });
    expect(autoModeLane(status({ effective: 'default', refusal: 'auto_mode_model' }), null, reviews)).toMatchObject({ kind: 'unavailable', reviews: null });
  });
});

describe('reviewsOf counts the tool calls the server lane evaluated', () => {
  it('is null without a transcript or with one that holds no turn, and counts each tool use once by its latest verdict', () => {
    expect(reviewsOf(undefined)).toBeNull();
    expect(reviewsOf(createState(null, null))).toBeNull();
    const b = builder();
    b.turn('u1');
    b.toolUse('a', 'Bash', { command: 'ls' });
    b.emit('tool.safeguard', { toolUseId: tool('a'), verdict: 'not_flagged', lane: 'server' });
    b.result('a', 'ok');
    b.toolUse('b', 'Bash', { command: 'rm -rf x' });
    b.result('b', 'no', { safeguard: 'flagged' });
    b.toolUse('c', 'Read', { file_path: '/x' });
    b.result('c', 'text');
    const state = applyEvents(createState(null, null), b.events);
    expect(reviewsOf(state)).toEqual({ evaluated: 2, flagged: 1 });
  });
});
