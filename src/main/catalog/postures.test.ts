// P4-AGG M4 (fix wave): a configured server's sign-in posture comes from the directory record its endpoint matches, never
// from a record that only shares its name; a server no record describes, or two records disagree on, stays unknown.
import { describe, expect, it } from 'vitest';
import type { ConnectorRoute } from '@shared/ipc/schema/catalog';
import { posturesOf } from './postures';

const route = (over: Partial<ConnectorRoute>): ConnectorRoute => ({ kind: 'connector', name: 'x', url: null, urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'auth_required', ...over });
const LINEAR = route({ name: 'linear', url: 'https://mcp.linear.app/mcp' });
const OPEN = route({ name: 'open-data', url: 'https://open.example/mcp', authPosture: 'no_auth' });
const SNOWFLAKE = route({ name: 'snowflake', urlPattern: '^https://[a-z0-9-]+\\.snowflakecomputing\\.com(/|$)' });
const REGIONAL = route({ name: 'regional', urlOptions: [{ url: 'https://eu.regional.example/mcp', label: 'EU', description: null }] });

describe('connector postures', () => {
  it('matches each configured server by its endpoint: URL, url_options or url_regex', () => {
    expect(posturesOf([
      { name: 'my-linear', scope: 'user', url: 'https://mcp.linear.app/mcp/' },
      { name: 'data', scope: 'project', url: 'https://open.example/mcp?key=k' },
      { name: 'sf', scope: 'local', url: 'https://acme.snowflakecomputing.com/api/mcp' },
      { name: 'eu', scope: 'user', url: 'https://eu.regional.example/mcp' },
    ], [LINEAR, OPEN, SNOWFLAKE, REGIONAL])).toEqual([
      { name: 'my-linear', scope: 'user', authPosture: 'auth_required' },
      { name: 'data', scope: 'project', authPosture: 'no_auth' },
      { name: 'sf', scope: 'local', authPosture: 'auth_required' },
      { name: 'eu', scope: 'user', authPosture: 'auth_required' },
    ]);
  });

  it('a server that only shares a record’s name, a stdio server, or one two records disagree on stays unknown', () => {
    const disagreeing = route({ name: 'open-mirror', url: 'https://open.example/mcp', authPosture: 'auth_required' });
    expect(posturesOf([
      { name: 'linear', scope: 'project', url: 'https://linear.internal.example/mcp' },
      { name: 'linear', scope: 'user', url: null },
      { name: 'data', scope: 'user', url: 'https://open.example/mcp' },
    ], [LINEAR, OPEN, disagreeing])).toEqual([
      { name: 'linear', scope: 'project', authPosture: null },
      { name: 'linear', scope: 'user', authPosture: null },
      { name: 'data', scope: 'user', authPosture: null },
    ]);
  });

  it('a pattern JavaScript cannot read matches nothing', () => {
    expect(posturesOf([{ name: 'odd', scope: 'user', url: 'https://odd.example/mcp' }], [route({ urlPattern: '^https://(?<a>odd' })])).toEqual([{ name: 'odd', scope: 'user', authPosture: null }]);
  });
});
