import { describe, expect, it } from 'vitest';
import { SessionRecordSchema } from '../graph/session';
import { commands as engineCommands } from '../ipc/schema/engine';
import { StartOptionsSchema } from '../ipc/schema/session';
import { SetupIntentPatchSchema, SetupIntentSchema } from '../sessions/intent';
import { LaunchSpecSchema } from './launch-spec';
import { legacyRouteOf, ObservedRouteSchema, readRecordedRoute, readRoute, RouteSchema } from './route';

const RELAY = 'http://127.0.0.1:8641';

const EngineModelsInputSchema = engineCommands['engine.models'].input;

describe('the route (P5 O7 M9)', () => {
  it('is one of three, and the observed route is one strict shape', () => {
    expect(RouteSchema.options).toEqual(['gateway', 'direct', 'machine']);
    expect(ObservedRouteSchema.parse({ kind: 'claudeusage', baseUrl: RELAY })).toEqual({ kind: 'claudeusage', baseUrl: RELAY });
    expect(ObservedRouteSchema.parse({ kind: 'login', baseUrl: null, login: 'Claude Max account', organization: 'Org' })).toMatchObject({ login: 'Claude Max account' });
    expect(ObservedRouteSchema.safeParse({ kind: 'host' }).success).toBe(false); // baseUrl is always written, null included
    expect(ObservedRouteSchema.safeParse({ kind: 'relay', baseUrl: null }).success).toBe(false);
    expect(ObservedRouteSchema.safeParse({ kind: 'host', baseUrl: 'https://example.com', extra: 1 }).success).toBe(false);
  });

  it('names the legacy route of a machine route by its effective base URL: gateway at the relay, direct otherwise', () => {
    expect(legacyRouteOf(RELAY, RELAY)).toBe('gateway');
    expect(legacyRouteOf(null, RELAY)).toBe('direct');
    expect(legacyRouteOf('https://llm.example.com', RELAY)).toBe('direct');
    expect(legacyRouteOf('http://127.0.0.1:9999', RELAY)).toBe('direct'); // the dev override's relay is another URL
  });

  it('reads `route` when present and the legacy field otherwise', () => {
    expect(readRoute({ gateway: 'gateway' })).toBe('gateway');
    expect(readRoute({ gateway: 'direct', route: 'machine' })).toBe('machine');
    expect(readRoute({})).toBeUndefined();
    expect(readRoute({ route: 'machine' })).toBe('machine');
    expect(readRecordedRoute({ routed: true })).toBe('gateway');
    expect(readRecordedRoute({ routed: false })).toBe('direct');
    expect(readRecordedRoute({ routed: null })).toBeNull();
    expect(readRecordedRoute({ routed: true, route: 'machine' })).toBe('machine');
  });

  it('travels as an optional property beside every legacy two-member field, which stays as it was', () => {
    const spec = {
      appSessionId: 'a1', cwd: '/w', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'direct', subagentModel: null, resume: null,
      sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null,
    };
    expect(LaunchSpecSchema.parse(spec)).not.toHaveProperty('route'); // an older writer's spec still reads
    expect(LaunchSpecSchema.parse({ ...spec, route: 'machine' }).route).toBe('machine');
    expect(LaunchSpecSchema.safeParse({ ...spec, gateway: 'machine' }).success).toBe(false); // the legacy enum keeps two members
    expect(StartOptionsSchema.parse({ route: 'machine' })).toEqual({ route: 'machine' });
    expect(StartOptionsSchema.safeParse({ gateway: 'machine' }).success).toBe(false);
    expect(EngineModelsInputSchema.parse({ refresh: false, gateway: 'direct', route: 'machine' })).toMatchObject({ route: 'machine' });
    expect(EngineModelsInputSchema.safeParse({ refresh: false, gateway: 'machine' }).success).toBe(false);
    expect(SetupIntentSchema.shape.route.safeParse(undefined).success).toBe(true);
    expect(SetupIntentSchema.shape.gateway.safeParse('machine').success).toBe(false);
    expect(SetupIntentPatchSchema.parse({ route: 'machine', gateway: 'direct' })).toEqual({ route: 'machine', gateway: 'direct' });
  });

  it("is recorded on the session record's gateway beside `routed`, with what the machine reported", () => {
    const gateway = { routed: false, baseUrl: null, autoModeServer: 'unknown' } as const;
    const shape = SessionRecordSchema.shape.gateway;
    expect(shape.parse(gateway)).toEqual(gateway); // a record written before M9
    expect(shape.parse({ ...gateway, route: 'machine', observed: { kind: 'login', baseUrl: null, login: 'Claude Max account' } })).toMatchObject({ route: 'machine', observed: { kind: 'login' } });
    expect(shape.safeParse({ ...gateway, routed: undefined, route: 'machine' }).success).toBe(false); // `routed` stays required
  });
});
