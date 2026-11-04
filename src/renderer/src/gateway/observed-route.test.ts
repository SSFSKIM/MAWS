// What a session's inference was observed reaching (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "The relay check and the features"): the features ClaudeUsage serves key on `observed.kind`, falling back to the legacy
// fields, never on the route chosen. And what Session info names: ClaudeUsage, the login, or the host.
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import { record, status } from '../../../../test/support/builders';
import { catalogueRoute, machineRouteLine, observedOf, routeChosen, throughClaudeUsage } from './observed-route';

const RELAY = 'http://127.0.0.1:8641';
const live = (gateway: Partial<EngineSessionStatus['gateway']>): EngineSessionStatus => {
  const s = status('a');
  return { ...s, gateway: { ...s.gateway, ...gateway } };
};
const kept = (gateway: Partial<SessionRecord['gateway']>): SessionRecord => {
  const r = record('a');
  return { ...r, gateway: { ...r.gateway, ...gateway } };
};

describe('whether a session goes through ClaudeUsage', () => {
  it('reads the live status’s observation over its legacy mode', () => {
    // a machine route the host named through ClaudeUsage, whatever the legacy field said before the check
    expect(throughClaudeUsage(live({ mode: 'direct', route: 'machine', observed: { kind: 'claudeusage', baseUrl: RELAY } }), null)).toBe(true);
    expect(throughClaudeUsage(live({ mode: 'gateway', route: 'machine', observed: { kind: 'login', baseUrl: null, login: 'Claude Max' } }), null)).toBe(false);
    expect(throughClaudeUsage(live({ mode: 'gateway', route: 'machine', observed: { kind: 'host', baseUrl: 'https://llm.example.test' } }), null)).toBe(false);
  });

  it('falls back to the legacy mode while the status carries no observation (an older host, or not verified yet)', () => {
    expect(throughClaudeUsage(live({ mode: 'gateway' }), null)).toBe(true);
    expect(throughClaudeUsage(live({ mode: 'direct' }), null)).toBe(false);
    // a live status is the current launch: the record's observation of an earlier one does not override it
    expect(throughClaudeUsage(live({ mode: 'direct' }), kept({ observed: { kind: 'claudeusage', baseUrl: RELAY } }))).toBe(false);
  });

  it('without a status, reads the record’s observation, then its `routed`, and says nothing for a session never verified', () => {
    expect(throughClaudeUsage(null, kept({ routed: false, route: 'machine', observed: { kind: 'claudeusage', baseUrl: RELAY } }))).toBe(true);
    expect(throughClaudeUsage(null, kept({ routed: true, observed: { kind: 'host', baseUrl: 'https://llm.example.test' } }))).toBe(false);
    expect(throughClaudeUsage(null, kept({ routed: true }))).toBe(true);
    expect(throughClaudeUsage(null, kept({ routed: false }))).toBe(false);
    expect(throughClaudeUsage(null, kept({ routed: null }))).toBeNull();
    expect(throughClaudeUsage(null, null)).toBeNull();
  });

  it('names the catalogue by what was observed: the relay’s for ClaudeUsage, the engine’s own otherwise', () => {
    expect(catalogueRoute(live({ mode: 'direct', route: 'machine', observed: { kind: 'claudeusage', baseUrl: RELAY } }), null)).toBe('gateway');
    expect(catalogueRoute(null, kept({ routed: true, route: 'machine', observed: { kind: 'login', baseUrl: null } }))).toBe('direct');
    expect(catalogueRoute(null, kept({ routed: null }))).toBeNull();
  });
});

describe('the route chosen and what was observed', () => {
  it('takes `route` first, then the legacy field', () => {
    expect(routeChosen(live({ mode: 'direct', route: 'machine' }), null)).toBe('machine');
    expect(routeChosen(live({ mode: 'direct' }), null)).toBe('direct');
    expect(routeChosen(null, kept({ routed: true, route: 'machine' }))).toBe('machine');
    expect(routeChosen(null, kept({ routed: false }))).toBe('direct');
    expect(routeChosen(null, kept({ routed: null }))).toBeNull();
  });

  it("keeps the record's chosen route through an older host's status, which names only the legacy mode", () => {
    expect(routeChosen(live({ mode: 'direct' }), kept({ routed: false, route: 'machine' }))).toBe('machine');
    expect(routeChosen(live({ mode: 'gateway', route: 'gateway' }), kept({ routed: false, route: 'machine' }))).toBe('gateway'); // the live additive route wins
    expect(routeChosen(live({ mode: 'gateway' }), kept({ routed: false }))).toBe('gateway'); // no additive route anywhere: the live legacy mode
  });

  it('reads the observation of the live status, else of the record when no process runs', () => {
    const named = { kind: 'host', baseUrl: 'https://llm.example.test' } as const;
    expect(observedOf(live({ observed: named }), null)).toEqual(named);
    expect(observedOf(live({}), kept({ observed: named }))).toBeNull();
    expect(observedOf(null, kept({ observed: named }))).toEqual(named);
  });
});

describe('Session info’s naming of the machine’s own route', () => {
  it('names ClaudeUsage, the Anthropic login, or the host, and never a mismatch', () => {
    expect(machineRouteLine({ kind: 'claudeusage', baseUrl: RELAY })).toBe(`The machine’s own · ClaudeUsage relay · ${RELAY}`);
    expect(machineRouteLine({ kind: 'login', baseUrl: null, login: 'Claude Max', organization: 'Acme' })).toBe('The machine’s own · Anthropic login · Claude Max');
    expect(machineRouteLine({ kind: 'login', baseUrl: null })).toBe('The machine’s own · Anthropic login');
    expect(machineRouteLine({ kind: 'host', baseUrl: 'https://llm.example.test/v1' })).toBe('The machine’s own · llm.example.test');
    expect(machineRouteLine({ kind: 'host', baseUrl: 'not a url' })).toBe('The machine’s own · not a url');
    expect(machineRouteLine(null)).toBe('The machine’s own · not verified yet');
  });
});
