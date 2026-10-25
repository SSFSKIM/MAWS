// Customize › Connectors' presenters (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding",
// "Signing in", "Which session", "My items", "Failure handling").
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { SignInRecord } from './sign-in';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { item } from '../discover/test-items';
import { argvOf } from '../../widgets/plugins/present';
import { installRequestOf } from '../discover/add';
import { cardContentsWords } from '../discover/present';
import { configuredOf, connectorAddOf, existingOf, resultFor, shadowedBy, shadowWords, nameProblem, removeRequestOf, removalDirectoryOf, scopesFor, signInSessionOf, signInViewOf, urlProblem, writesFor } from './present';

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
const event = (over: Partial<ConnectorSignInChanged>, at = 1_000, appSessionId = 's1', fingerprint: string | null = 'print'): SignInRecord => ({ event: { opId: 'op', name: 'linear', state: 'starting', reason: null, message: null, where: null, ...over }, appSessionId, at, fingerprint });

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

  it('checks an instance URL against the pattern as the directory writes it, and any URL as http or https', () => {
    const pattern = '^https://api\\.salesforce\\.com/platform/mcp/v1/platform/headless-360$';
    expect(urlProblem('', pattern)).toBe('Enter the server’s URL.');
    expect(urlProblem('https://api.salesforce.com/platform/mcp/v1/platform/headless-360', pattern)).toBeNull();
    expect(urlProblem('https://evil.example.com/?https://api.salesforce.com/platform/mcp/v1/platform/headless-360', pattern)).toBe(`The URL must match ${pattern}`);
    // a prefix pattern (17 of the directory's 52 have no `$`) admits the paths under it
    const snowflake = '^https://[a-zA-Z0-9._-]+\\.snowflakecomputing\\.com(/|$)';
    expect(urlProblem('https://acme.snowflakecomputing.com/api/v2/databases/db/schemas/s/mcp-servers/m', snowflake)).toBeNull();
    expect(urlProblem('https://acme.snowflakecomputing.com.evil.example/', snowflake)).toBe(`The URL must match ${snowflake}`);
    // one without `^` is held from the start, never found inside another URL
    expect(urlProblem('https://evil.example.com/?https://api.salesforce.com/x', 'https://api\\.salesforce\\.com/')).toBe('The URL must match https://api\\.salesforce\\.com/');
    expect(urlProblem('ftp://x.example.com', null)).toBe('Enter an http or https URL.');
  });

  it('refuses a URL against a pattern JavaScript cannot read: being unable to check is never a pass', () => {
    expect(urlProblem('https://x.example.com/mcp', '([')).toBe('This server’s URL pattern can’t be checked.');
    expect(urlProblem('', '([')).toBe('This server’s URL pattern can’t be checked.'); // said before anything is typed
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

  it('holds what is configured here as Add needs it: read whole, partial, failed, or still reading', () => {
    const servers = [server()];
    expect(configuredOf({ data: { servers, serversRead: true }, error: null })).toEqual({ state: 'read', servers });
    expect(configuredOf({ data: { servers, serversRead: false }, error: null })).toEqual({ state: 'partial' });
    expect(configuredOf({ data: undefined, error: new Error('the engine host is not running') })).toEqual({ state: 'failed', message: 'the engine host is not running' });
    expect(configuredOf({ data: undefined, error: null })).toEqual({ state: 'reading' });
    // a refresh that failed: the answer kept from before vouches for nothing now
    expect(configuredOf({ data: { servers: [], serversRead: true }, error: new Error('configuration is unreadable now') })).toEqual({ state: 'failed', message: 'configuration is unreadable now' });
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

  it('runs a removal where the entry lives: a project entry in the directory of its own .mcp.json, others where the page is (sweep#2)', () => {
    expect(removalDirectoryOf(server({ scope: 'project', path: '/repo/.mcp.json' }))).toBe('/repo');
    expect(removalDirectoryOf(server({ scope: 'project', path: '/.mcp.json' }))).toBe('/');
    expect(removalDirectoryOf(server({ scope: 'local' }))).toBeNull(); // the page's project key
    expect(removalDirectoryOf(server({ scope: 'user' }))).toBeNull();
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
  it('signs a user-scope server in from a ready session in the page’s directory first, whose entries the page shows (scalpel-2#1)', () => {
    const sessions = [{ appSessionId: 'a', cwd: '/p' }, { appSessionId: 'b', cwd: '/q' }];
    expect(signInSessionOf('user', sessions, null, '/q')).toBe('b');
    expect(signInSessionOf('user', sessions, null, null)).toBe('a'); // the user configuration's page: main checks the session's own entries
  });

  it('a server the session already had connected says so, not that a sign-in happened (scalpel-2#3)', () => {
    expect(signInViewOf({ live: undefined, liveRead: null, posture: null, transport: 'http', last: event({ state: 'done', where: 'here', message: 'already connected' }) })).toEqual({ text: 'Already connected in that session', tone: 'success', signIn: false, cancel: false });
  });

  it('a session that uses another entry of the name says so', () => {
    expect(signInViewOf({ live: undefined, liveRead: null, posture: null, transport: 'http', last: event({ state: 'failed', reason: 'other_entry', message: 'that session uses the local entry in /cfg/.claude.json' }) })!.text).toBe('Sign-in didn’t finish: that session uses the local entry in /cfg/.claude.json');
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
  const none = { live: undefined, liveRead: null, posture: null, last: null, transport: 'http' };
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

describe('a finished sign-in against what the session reports now', () => {
  const needsAuth = { status: 'needs-auth', error: null };
  const facts = (last: SignInRecord, live: { status: string; error: string | null } | null, liveRead: { appSessionId: string; at: number } | null) => ({ live, liveRead, last, posture: 'auth_required' as const, transport: 'http' });

  it('a read newer than a success that says the server needs a sign-in, or failed, is what the row says, with Sign in', () => {
    const done = event({ state: 'done', where: 'here' }, 1_000, 's1');
    expect(signInViewOf(facts(done, needsAuth, { appSessionId: 's1', at: 2_000 }))).toEqual({ text: 'Sign in needed', tone: 'muted', signIn: true, cancel: false });
    expect(signInViewOf(facts(done, needsAuth, { appSessionId: 's2', at: 2_000 }))).toMatchObject({ text: 'Sign in needed', signIn: true }); // the attached session is another
    expect(signInViewOf(facts(done, { status: 'failed', error: 'HTTP 401' }, { appSessionId: 's1', at: 2_000 }))).toMatchObject({ text: 'Failed: HTTP 401', signIn: true });
  });

  it('a read from before the success, one that lists it connected, or one that does not list it leaves the success', () => {
    const done = event({ state: 'done', where: 'here' }, 1_000, 's1');
    expect(signInViewOf(facts(done, needsAuth, { appSessionId: 's1', at: 900 }))).toMatchObject({ text: 'Signed in · connected here', signIn: false });
    expect(signInViewOf(facts(done, { status: 'connected', error: null }, { appSessionId: 's1', at: 2_000 }))).toMatchObject({ text: 'Signed in · connected here' });
    expect(signInViewOf(facts(done, null, { appSessionId: 's2', at: 2_000 }))).toMatchObject({ text: 'Signed in · connected here' });
  });

  it('a success for new sessions stands against the signing session’s own read, which it never claimed', () => {
    const later = event({ state: 'done', where: 'new_sessions' }, 1_000, 's1');
    expect(signInViewOf(facts(later, needsAuth, { appSessionId: 's1', at: 2_000 }))).toMatchObject({ text: 'Signed in · available in new sessions', signIn: false });
    expect(signInViewOf(facts(later, needsAuth, { appSessionId: 's2', at: 2_000 }))).toMatchObject({ text: 'Sign in needed', signIn: true });
  });

  it('a sign-in that did not finish stays said, with Sign in, whatever the session reads after it', () => {
    const failed = event({ state: 'failed', reason: 'timeout' }, 1_000);
    expect(signInViewOf(facts(failed, needsAuth, { appSessionId: 's1', at: 2_000 }))).toEqual({ text: 'Sign-in didn’t finish: the browser didn’t return within 5 minutes', tone: 'danger', signIn: true, cancel: false });
  });
});

describe('which result a row shows', () => {
  it('a finished sign-in only for the configuration it was for: its fingerprint, known on both sides', () => {
    const done = event({ state: 'done', where: 'here' }, 1_000, 's1', 'print-1');
    expect(resultFor(done, 'print-1')).toBe(done);
    expect(resultFor(done, 'print-2')).toBeNull(); // removed, and another endpoint added under the name and scope
    expect(resultFor(done, null)).toBeNull(); // the configuration's fingerprint is not read: nothing is vouched for
    expect(resultFor(event({ state: 'failed', reason: 'timeout' }, 1_000, 's1', null), null)).toBeNull();
    expect(resultFor(null, 'print-1')).toBeNull();
  });

  it('a sign-in under way, whatever the fingerprints say: it is this slot’s one operation, and Cancel must reach it', () => {
    const running = event({ state: 'waiting_callback' }, 1_000, 's1', null);
    expect(resultFor(running, 'print-1')).toBe(running);
  });
});

describe('a name configured in more than one scope', () => {
  // the engine's precedence (2.1.309 cli.pretty.js 720870, 720898): local over user over project, and among project
  // .mcp.json files the one nearest the directory (720717: read from the root down, each assigned over the last)
  const user = server({ scope: 'user' });
  const local = server({ scope: 'local' });
  const outer = server({ scope: 'project', path: '/p/.mcp.json' });
  const inner = server({ scope: 'project', path: '/p/app/.mcp.json' });
  const app = server({ scope: 'app', path: '/maws/settings.json' });

  it('names the entry the engine uses over each other one; the used one is shadowed by none', () => {
    const files = [user, outer, inner, local];
    expect(shadowedBy(local, files)).toBeNull();
    expect(shadowedBy(user, files)).toBe('local');
    expect(shadowedBy(inner, files)).toBe('local');
    expect(shadowedBy(outer, files)).toBe('local');
    expect(shadowedBy(user, [user, inner])).toBeNull();
    expect(shadowedBy(inner, [user, inner])).toBe('user');
    expect(shadowedBy(outer, [outer, inner])).toBe('project'); // the nearer .mcp.json
    expect(shadowedBy(inner, [outer, inner])).toBeNull();
    expect(shadowedBy(user, [user, server({ name: 'notion', scope: 'local' })])).toBeNull(); // another name
  });

  it('MAWS’s own server of the same name shadows every file entry: the engine loads it as a dynamic server and signs that one in', () => {
    // 2.1.309 cli.pretty.js 457558 parses --mcp-config as scope "dynamic"; the authentication resolver (853424) prefers a
    // loaded client's own configuration over the files'
    for (const row of [user, outer, inner, local]) expect(shadowedBy(row, [app, user, outer, inner, local])).toBe('app');
    expect(shadowedBy(app, [app, user, local])).toBeNull();
    expect(shadowedBy(user, [server({ name: 'notion', scope: 'app' }), user])).toBeNull(); // another name
  });

  it('says what shadows a row: the engine’s entry by scope, or MAWS’s server by name', () => {
    expect(shadowWords('local', 'linear')).toBe('Shadowed by the local entry');
    expect(shadowWords('app', 'linear')).toBe('Shadowed by MAWS’s linear server');
  });
});
