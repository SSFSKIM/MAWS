// Customize › Connectors' presenters (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding",
// "Signing in", "Which session", "My items", "Failure handling").
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { item } from '../discover/test-items';
import { argvOf } from '../../widgets/plugins/present';
import { installRequestOf } from '../discover/add';
import { cardContentsWords } from '../discover/present';
import { connectorAddOf, existingOf, nameProblem, removeRequestOf, scopesFor, signInSessionOf, signInViewOf, urlProblem, writesFor } from './present';

const linear = (over: Partial<CatalogItem['install']> = {}, item_: Partial<CatalogItem> = {}): CatalogItem =>
  item({
    id: 'fa50c30c',
    kind: 'connector',
    name: 'Linear',
    installName: 'linear',
    publisher: 'Linear (Linear Orbit, Inc.)',
    reviewTier: 'partner',
    rank: 14,
    components: { skills: [], mcpServers: [{ name: 'linear', transport: 'http' }], hooks: false, commands: 0, agents: 0, cli: false },
    install: { kind: 'connector', name: 'linear', url: 'https://mcp.linear.app/mcp', urlPattern: null, urlOptions: [], transport: 'http', authPosture: 'auth_required', ...over } as CatalogItem['install'],
    ...item_,
  });

const server = (over: Partial<CustomizationServer> = {}): CustomizationServer => ({ name: 'linear', scope: 'user', path: '/cfg/.claude.json', transport: 'http', ...over });
const event = (over: Partial<ConnectorSignInChanged>): ConnectorSignInChanged => ({ opId: 'op', name: 'linear', state: 'starting', reason: null, message: null, where: null, ...over });

describe('adding a connector', () => {
  it('asks claude mcp add with the directory’s name, URL and transport at user scope, carrying what the sheet shows', () => {
    const request = connectorAddOf(linear())!;
    expect(request).toMatchObject({ action: 'mcp-add', input: { name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http', scope: 'user' } });
    expect(request.connector).toEqual({ name: 'Linear', publisher: 'Linear (Linear Orbit, Inc.)', trust: 'Partner', urlPattern: null, urlOptions: [], authPosture: 'auth_required' });
    expect(argvOf(request)).toEqual(['mcp', 'add', '--transport', 'http', 'linear', 'https://mcp.linear.app/mcp', '--scope', 'user']);
  });

  it('starts an instance-URL server with an empty URL and a url_options server with its first option', () => {
    expect(connectorAddOf(linear({ url: null, urlPattern: '^https://api\\.salesforce\\.com/.+$' }))!.input).toMatchObject({ url: '' });
    const options = [{ url: 'https://eu.example.com/mcp', label: 'EU', description: null }, { url: 'https://us.example.com/mcp', label: 'US', description: null }];
    expect(connectorAddOf(linear({ url: null, urlOptions: options }))!.input).toMatchObject({ url: 'https://eu.example.com/mcp' });
  });

  it('is what a connector card’s + asks, and the card shows the URL it adds', () => {
    expect(installRequestOf(linear(), 'connectors')).toEqual(connectorAddOf(linear()));
    expect(cardContentsWords(linear(), 'connectors')).toBe('https://mcp.linear.app/mcp');
    expect(cardContentsWords(linear({ url: null, urlPattern: '^https://.+$' }), 'connectors')).toBe('Asks for your instance’s URL');
  });

  it('offers nothing for a plugin route or a failed scan', () => {
    expect(connectorAddOf(item())).toBeNull();
    expect(connectorAddOf(linear({}, { scanBlocked: 'failed' }))).toBeNull();
  });

  it('checks an instance URL against the whole pattern, and any URL as http or https', () => {
    const pattern = '^https://api\\.salesforce\\.com/platform/mcp/v1/platform/headless-360$';
    expect(urlProblem('', pattern)).toBe('Enter the server’s URL.');
    expect(urlProblem('https://api.salesforce.com/platform/mcp/v1/platform/headless-360', pattern)).toBeNull();
    expect(urlProblem('https://evil.example.com/?https://api.salesforce.com/platform/mcp/v1/platform/headless-360', pattern)).toBe(`The URL must match ${pattern}`);
    expect(urlProblem('https://api.salesforce.com/platform/mcp/v1/platform/headless-360x', 'https://api\\.salesforce\\.com/.+/headless-360')).toBe('The URL must match https://api\\.salesforce\\.com/.+/headless-360'); // unanchored patterns match whole
    expect(urlProblem('ftp://x.example.com', null)).toBe('Enter an http or https URL.');
    expect(urlProblem('https://x.example.com/mcp', '([')).toBeNull(); // a pattern JavaScript cannot read checks only the scheme
  });

  it('holds the name to the engine’s rule', () => {
    expect(nameProblem('linear_2-b')).toBeNull();
    expect(nameProblem('')).toBe('Enter a name.');
    expect(nameProblem('google drive')).toBe('Use letters, digits, hyphens and underscores only.');
  });

  it('refuses a name configured in any scope that applies here, naming the existing entry', () => {
    const servers = [server({ name: 'notion', scope: 'project', path: '/p/.mcp.json' }), server()];
    expect(existingOf('linear', servers)).toEqual(server());
    expect(existingOf('notion', servers)).toEqual(servers[0]);
    expect(existingOf('canva', servers)).toBeNull();
  });

  it('offers user scope alone on the user configuration, the three scopes in a project', () => {
    expect(scopesFor(null)).toEqual(['user']);
    expect(scopesFor('/p')).toEqual(['user', 'project', 'local']);
  });

  it('names the file each scope writes', () => {
    const env = { globalConfig: '/cfg/.claude.json', cwd: '/p' };
    expect(writesFor('user', env)).toBe('/cfg/.claude.json');
    expect(writesFor('local', env)).toBe('/cfg/.claude.json');
    expect(writesFor('project', env)).toBe('/p/.mcp.json');
  });
});

describe('removing a connector', () => {
  it('asks claude mcp remove at the server’s own scope; MAWS’s own servers are not the engine’s to remove', () => {
    const request = removeRequestOf(server({ scope: 'local' }))!;
    expect(argvOf(request)).toEqual(['mcp', 'remove', 'linear', '--scope', 'local']);
    expect(removeRequestOf(server({ scope: 'app' }))).toBeNull();
  });
});

describe('which session signs in', () => {
  const ready = [
    { appSessionId: 'b', cwd: '/elsewhere' },
    { appSessionId: 'a', cwd: '/p' },
  ];
  it('takes the attached session first', () => {
    expect(signInSessionOf('project', ready, 'a', '/p')).toBe('a');
    expect(signInSessionOf('user', ready, 'a', '/p')).toBe('a');
  });
  it('signs a user-scope server in from any ready session, and a project or local one only from a session in that directory', () => {
    expect(signInSessionOf('user', ready, null, null)).toBe('a');
    expect(signInSessionOf('local', ready, null, '/p')).toBe('a');
    expect(signInSessionOf('project', ready, null, '/q')).toBeNull();
    expect(signInSessionOf('user', [], null, null)).toBeNull();
    expect(signInSessionOf('app', ready, null, '/p')).toBeNull(); // MAWS's own servers sign in through Connections, not here
  });
});

describe('a server’s sign-in state', () => {
  const none = { live: undefined, posture: null, last: null, transport: 'http' };
  it('reads the attached session’s mcp_status first', () => {
    expect(signInViewOf({ ...none, live: { status: 'connected', error: null } })).toEqual({ text: 'Connected', tone: 'success', signIn: false, cancel: false });
    expect(signInViewOf({ ...none, live: { status: 'needs-auth', error: null } })).toEqual({ text: 'Sign in needed', tone: 'muted', signIn: true, cancel: false });
    expect(signInViewOf({ ...none, live: { status: 'failed', error: 'HTTP 500' } })).toEqual({ text: 'Failed: HTTP 500', tone: 'danger', signIn: true, cancel: false });
    expect(signInViewOf({ ...none, live: { status: 'pending', error: null } })).toMatchObject({ text: 'Connecting…', signIn: false });
  });

  it('without a session listing it, the directory’s posture: Sign in needed, or No sign-in needed', () => {
    expect(signInViewOf({ ...none, posture: 'auth_required' })).toEqual({ text: 'Sign in needed', tone: 'muted', signIn: true, cancel: false });
    expect(signInViewOf({ ...none, live: null, posture: 'no_auth' })).toEqual({ text: 'No sign-in needed', tone: 'muted', signIn: false, cancel: false });
    expect(signInViewOf({ ...none, live: { status: 'connected', error: null }, posture: 'no_auth' })).toMatchObject({ text: 'Connected · No sign-in needed', signIn: false });
    expect(signInViewOf(none)).toEqual({ text: null, tone: 'muted', signIn: true, cancel: false }); // nothing observed: no words, Sign in offered
    expect(signInViewOf({ ...none, transport: 'stdio', posture: 'auth_required' })).toBeNull(); // a local server signs in nowhere
  });

  it('a sign-in under way: its step, Cancel, and Sign in again (a second press cancels the first)', () => {
    expect(signInViewOf({ ...none, posture: 'auth_required', last: event({ state: 'waiting_callback' }) })).toEqual({ text: 'Finish signing in in your browser…', tone: 'muted', signIn: true, cancel: true });
  });

  it('a finished sign-in: Signed in, connected here or available in new sessions', () => {
    expect(signInViewOf({ ...none, last: event({ state: 'done', where: 'here' }) })).toMatchObject({ text: 'Signed in · connected here', tone: 'success', signIn: false });
    expect(signInViewOf({ ...none, last: event({ state: 'done', where: 'new_sessions' }) })).toMatchObject({ text: 'Signed in · available in new sessions', tone: 'success', signIn: false });
  });

  it('a sign-in that did not finish says why and can be pressed again', () => {
    expect(signInViewOf({ ...none, last: event({ state: 'failed', reason: 'timeout' }) })).toEqual({ text: 'Sign-in didn’t finish: the browser didn’t return within 5 minutes', tone: 'danger', signIn: true, cancel: false });
    expect(signInViewOf({ ...none, last: event({ state: 'failed', reason: 'engine', message: 'Server not found' }) })!.text).toBe('Sign-in didn’t finish: Server not found');
    expect(signInViewOf({ ...none, last: event({ state: 'failed', reason: 'denied', message: 'access_denied' }) })!.text).toBe('Sign-in didn’t finish: the sign-in was declined (access_denied)');
    expect(signInViewOf({ ...none, last: event({ state: 'failed', reason: 'session_exited' }) })!.text).toBe('Sign-in didn’t finish: the session ended');
    expect(signInViewOf({ ...none, last: event({ state: 'cancelled' }) })!.text).toBe('Sign-in didn’t finish: cancelled');
  });
});

describe('the directory’s posture My items reads', () => {
  it('comes only from catalog reads the window already holds: a home, a query’s pages, an item', async () => {
    const { QueryClient } = await import('@tanstack/react-query');
    const { cachedPosture } = await import('../discover/read');
    const client = new QueryClient();
    expect(cachedPosture('linear', client)).toBeNull();
    client.setQueryData(['maws', 'catalog', 'query', { tab: 'connectors' }], { pages: [{ items: [linear()] }], pageParams: [null] });
    expect(cachedPosture('linear', client)).toBe('auth_required');
    client.clear();
    client.setQueryData(['maws', 'catalog', 'home', { tab: 'connectors' }], { featured: null, shelves: [{ items: [linear({ name: 'learn', authPosture: 'no_auth' })] }] });
    expect(cachedPosture('learn', client)).toBe('no_auth');
    expect(cachedPosture('linear', client)).toBeNull();
  });
});
