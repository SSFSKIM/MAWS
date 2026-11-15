// P4-AGG M4 (fix wave): a configured server's sign-in posture comes from the directory record its endpoint matches, never
// from a record that only shares its name; a server no record describes, or two records disagree on, stays unknown. Each
// carries an opaque fingerprint of its configuration, so a sign-in's result is shown only for the configuration it was for.
import { describe, expect, it } from 'vitest';
import type { CustomizationEndpoint } from '@shared/ipc/schema';
import type { ConnectorRoute } from '@shared/ipc/schema/catalog';
import { configurationFingerprint, posturesOf, type ListedConnector } from './postures';

const route = (over: Partial<ConnectorRoute>): ConnectorRoute => ({ kind: 'connector', name: 'x', url: null, urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'auth_required', ...over });
const LINEAR = route({ name: 'linear', url: 'https://mcp.linear.app/mcp' });
const OPEN = route({ name: 'open-data', url: 'https://open.example/mcp', authPosture: 'no_auth' });
const SNOWFLAKE = route({ name: 'snowflake', urlPattern: '^https://[a-z0-9-]+\\.snowflakecomputing\\.com(/|$)' });
const REGIONAL = route({ name: 'regional', urlOptions: [{ url: 'https://eu.regional.example/mcp', label: 'EU', description: null }] });
const at = (name: string, scope: CustomizationEndpoint['scope'], url: string | null, path = '/cfg/.claude.json'): CustomizationEndpoint => ({ name, scope, path, transport: url === null ? 'stdio' : 'http', url });
const NO_PRINT = () => null;
const listed = (...routes: ConnectorRoute[]): ListedConnector[] => routes.map((r) => ({ route: r, iconUrl: null }));

describe('connector postures', () => {
  it('matches each configured server by its endpoint: URL, url_options or url_regex', () => {
    expect(posturesOf([at('my-linear', 'user', 'https://mcp.linear.app/mcp/'), at('data', 'project', 'https://open.example/mcp?key=k'), at('sf', 'local', 'https://acme.snowflakecomputing.com/api/mcp'), at('eu', 'user', 'https://eu.regional.example/mcp')], listed(LINEAR, OPEN, SNOWFLAKE, REGIONAL), NO_PRINT)).toEqual([
      { name: 'my-linear', scope: 'user', path: '/cfg/.claude.json', authPosture: 'auth_required', fingerprint: null, revision: null, iconUrl: null },
      { name: 'data', scope: 'project', path: '/cfg/.claude.json', authPosture: 'no_auth', fingerprint: null, revision: null, iconUrl: null },
      { name: 'sf', scope: 'local', path: '/cfg/.claude.json', authPosture: 'auth_required', fingerprint: null, revision: null, iconUrl: null },
      { name: 'eu', scope: 'user', path: '/cfg/.claude.json', authPosture: 'auth_required', fingerprint: null, revision: null, iconUrl: null },
    ]);
  });

  it('a server that only shares a record’s name, a stdio server, or one two records disagree on stays unknown', () => {
    const disagreeing = route({ name: 'open-mirror', url: 'https://open.example/mcp', authPosture: 'auth_required' });
    expect(posturesOf([at('linear', 'project', 'https://linear.internal.example/mcp'), at('linear', 'user', null), at('data', 'user', 'https://open.example/mcp')], listed(LINEAR, OPEN, disagreeing), NO_PRINT).map((p) => p.authPosture)).toEqual([null, null, null]);
  });

  it('a pattern JavaScript cannot read matches nothing', () => {
    expect(posturesOf([at('odd', 'user', 'https://odd.example/mcp')], listed(route({ urlPattern: '^https://(?<a>odd' })), NO_PRINT)[0]!.authPosture).toBeNull();
  });

  it('carries each configuration’s opaque fingerprint: the same for the same endpoint and transport, another for any change, never the URL', () => {
    const print = configurationFingerprint(Buffer.alloc(32, 7));
    const secret = 'https://mcp.linear.app/mcp?token=SECRET';
    const a = print({ transport: 'http', url: secret })!;
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(print({ transport: 'http', url: secret })).toBe(a);
    expect(print({ transport: 'sse', url: secret })).not.toBe(a);
    expect(print({ transport: 'http', url: 'https://other.example/mcp' })).not.toBe(a);
    expect(configurationFingerprint(Buffer.alloc(32, 8))({ transport: 'http', url: secret })).not.toBe(a); // keyed per run
    expect(print({ transport: 'stdio', url: null })).toBeNull();
    const [posture] = posturesOf([{ name: 'linear', scope: 'user', path: '/cfg/.claude.json', transport: 'http', url: secret }], listed(LINEAR), print);
    expect(posture).toEqual({ name: 'linear', scope: 'user', path: '/cfg/.claude.json', authPosture: 'auth_required', fingerprint: a, revision: null, iconUrl: null });
    expect(JSON.stringify(posture)).not.toMatch(/SECRET|linear\.app/);
  });

  it('two project files configuring one name: each answer names its own file, with its own posture and fingerprint', () => {
    const print = configurationFingerprint(Buffer.alloc(32, 7));
    const [outer, inner] = posturesOf([at('linear', 'project', 'https://open.example/mcp', '/p/.mcp.json'), at('linear', 'project', 'https://mcp.linear.app/mcp', '/p/app/.mcp.json')], listed(LINEAR, OPEN), print);
    expect(outer).toMatchObject({ path: '/p/.mcp.json', authPosture: 'no_auth' });
    expect(inner).toMatchObject({ path: '/p/app/.mcp.json', authPosture: 'auth_required' });
    expect(outer!.fingerprint).not.toBe(inner!.fingerprint);
  });

  // UX wave U11a M8 (§A): the engine host's revision of each configuration, handed to the row beside its posture; main's
  // own fingerprint is not changed by it, and an engine host of an earlier build answers none
  it('hands each endpoint’s revision to the row beside its posture, null where the engine host answered none', () => {
    const print = configurationFingerprint(Buffer.alloc(32, 7));
    const [stamped, older, none] = posturesOf([{ ...at('fx-own', 'app', 'https://own.example.test/mcp', '/maws/machine-settings.json'), revision: 'rev-1' }, at('linear', 'user', 'https://mcp.linear.app/mcp'), { ...at('process', 'user', null), revision: null }], listed(LINEAR), print);
    expect(stamped).toMatchObject({ name: 'fx-own', scope: 'app', revision: 'rev-1', fingerprint: print({ transport: 'http', url: 'https://own.example.test/mcp' }) });
    expect(older!.revision).toBeNull();
    expect(none!.revision).toBeNull();
  });

  // UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C): the row's directory icon, by the
  // same match, and only where one record is matched
  it('hands each endpoint the icon of the one record it matches; none for two records, none for none', () => {
    const TIDES = { route: route({ name: 'tides', url: 'https://mcp.tides.example/mcp' }), iconUrl: 'https://icons.example/tides.svg' };
    const MOORINGS = { route: route({ name: 'moorings', url: 'https://mcp.moorings.example/mcp' }), iconUrl: 'https://icons.example/moorings.png' };
    const MIRROR = { route: route({ name: 'moorings-mirror', url: 'https://mcp.moorings.example/mcp' }), iconUrl: 'https://icons.example/mirror.png' };
    const postures = posturesOf([at('my-tides', 'user', 'https://mcp.tides.example/mcp'), at('moorings', 'user', 'https://mcp.moorings.example/mcp'), at('buoy', 'user', 'https://buoy.internal.example/mcp'), at('local', 'user', null)], [TIDES, MOORINGS, MIRROR], NO_PRINT);
    expect(postures.map((p) => p.iconUrl)).toEqual(['https://icons.example/tides.svg', null, null, null]);
  });
});
