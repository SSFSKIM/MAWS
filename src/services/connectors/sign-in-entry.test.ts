// scalpel-2#1: a sign-in runs only in a session whose engine uses the entry the row is. The engine is asked for a server
// by name alone, so a session whose directory has another entry of the name (a local override of a user server, MAWS's
// own server) would sign that one in, and its success would be shown on the wrong row.
import { describe, expect, it } from 'vitest';
import { dynamicRefusal, entryRefusal } from './sign-in-entry';

const GLOBAL = '/cfg/.claude.json';
const URL_U = 'https://u.example/mcp';
const user = { name: 'linear', scope: 'user', path: GLOBAL, transport: 'http', url: URL_U } as const;
const local = { name: 'linear', scope: 'local', path: GLOBAL, transport: 'http', url: 'https://l.example/mcp' } as const;
const project = (path: string) => ({ name: 'linear', scope: 'project', path, transport: 'http', url: 'https://p.example/mcp' }) as const;
const DIFFERENT = 'this session uses a different linear; start a new session to sign in';
// what 2.1.309's mcp_status reports for a server (cli.pretty.js 1128186): its scope, transport and redacted config
const live = (scope: string, url: string, transport = 'http') => ({ name: 'linear', status: 'needs-auth', scope, transport, config: { type: transport, url } });

describe('the session’s entry for a sign-in', () => {
  it('is the requested one: nothing to refuse', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [])).toBeNull();
    expect(entryRefusal({ ...local, cwd: '/p' }, '/p', [user, local], [])).toBeNull();
    expect(entryRefusal({ name: 'linear', scope: 'project', path: '/p/.mcp.json', cwd: '/p' }, '/p', [project('/p/.mcp.json')], [])).toBeNull();
  });

  it('is another: a local override, MAWS’s own server, a nearer project file, or none at all', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user, local], [])).toBe(`that session uses the local entry in ${GLOBAL}`);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user, { name: 'linear', scope: 'app', path: '/maws/settings.json', transport: 'http', url: URL_U }], [])).toBe('that session uses MAWS’s linear server');
    expect(entryRefusal({ name: 'linear', scope: 'project', path: '/p/.mcp.json', cwd: '/p/app' }, '/p/app', [project('/p/.mcp.json'), project('/p/app/.mcp.json')], [])).toBe('that session uses the project entry in /p/app/.mcp.json');
    expect(entryRefusal({ ...user, cwd: null }, '/p', [], [])).toBe('that session has no linear entry');
  });

  it('a local entry is its project’s: a session in another directory does not use it', () => {
    expect(entryRefusal({ ...local, cwd: '/p' }, '/q', [user, local], [])).toBe('that session runs in /q, not /p');
  });

  // fix-D#4: the engine signs in the server it holds, which is what it read at launch, not what the files say now
  it('is the one the running engine holds: same scope and endpoint, as its mcp_status reports them', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U)])).toBeNull();
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [])).toBeNull(); // not in its status yet: it reads the files when asked
  });

  it('reads streamable-http as http on either side, as the engine does (2.1.309 cli.pretty.js 719781)', () => {
    // an entry typed streamable-http on disk: the inventory reads it as http; the engine may report either spelling
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U, 'streamable-http')])).toBeNull();
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U, 'http')])).toBeNull();
    const raw = { ...user, transport: 'streamable-http' } as const;
    expect(entryRefusal({ ...user, cwd: null }, '/p', [raw], [live('user', URL_U, 'http')])).toBeNull();
  });

  it('is not, when the running engine holds another: an app server given at launch and since removed, or a changed endpoint', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('dynamic', URL_U)])).toBe(DIFFERENT);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', 'https://old.example/mcp')])).toBe(DIFFERENT);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [live('user', URL_U, 'sse')])).toBe(DIFFERENT);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user], [{ name: 'linear' }])).toBe(DIFFERENT); // says nothing of its entry
  });
});

// UX wave U11a (§A, "The check"): a dynamic connector, one a plugin brings or one of MAWS's own list, is the session's
// own server of the name, which its mcp_status lists with scope `dynamic`; a press from a row of MAWS's own list also
// names the configuration that row was drawn from, by its revision, which must still be the entry's and the session's.
describe('the session’s server for a dynamic sign-in', () => {
  const OWN_URL = 'https://own.example.test/mcp';
  const NEW_URL = 'https://own-moved.example.test/mcp';
  const held = (name: string, over: Record<string, unknown> = {}) => ({ name, status: 'needs-auth', scope: 'dynamic', transport: 'http', config: { type: 'http', url: OWN_URL }, ...over });
  const own = (over: Record<string, unknown> = {}) => ({ name: 'fx-own', scope: 'app', path: '/maws/machine-settings.json', transport: 'http', url: OWN_URL, revision: 'rev-1', ...over }) as const;
  const PRESS = { name: 'fx-own', entry: { revision: 'rev-1' } };
  const CHANGED = 'MAWS’s fx-own server changed since this page read it; refresh the page, then sign in';
  const OTHER = 'this session uses a different fx-own; start a new session to sign in';

  it('is the dynamic server the session lists: a plugin’s, or one of MAWS’s own list pressed from the dialog', () => {
    expect(dynamicRefusal({ name: 'plugin:fx-plugin:fx-oauth' }, [held('plugin:fx-plugin:fx-oauth')], [])).toBeNull();
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-own')], [])).toBeNull();
    // a press from the dialog names no entry: MAWS's list is not consulted, whatever it says now
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-own')], [own({ url: NEW_URL, revision: 'rev-2' })])).toBeNull();
  });

  it('is none, or a file-configured one, in a session that does not hold it', () => {
    expect(dynamicRefusal({ name: 'fx-own' }, [], [])).toBe('that session has no fx-own server');
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-other')], [])).toBe('that session has no fx-own server');
    expect(dynamicRefusal({ name: 'fx-own' }, [held('fx-own', { scope: 'user' })], [])).toBe(OTHER);
    expect(dynamicRefusal(PRESS, [held('fx-own', { scope: 'project' })], [own()])).toBe(OTHER);
  });

  it('a press from MAWS’s own list: the entry of the revision it was drawn with, and the session’s server is that entry', () => {
    expect(dynamicRefusal(PRESS, [held('fx-own')], [own()])).toBeNull();
    // `streamable-http` is the engine's `http`; an address written with ${…} is the engine's to expand, not compared
    expect(dynamicRefusal(PRESS, [held('fx-own', { transport: 'streamable-http' })], [own()])).toBeNull();
    expect(dynamicRefusal(PRESS, [held('fx-own', { config: { type: 'http', url: 'https://expanded.example.test/mcp' } })], [own({ url: 'https://${HOST}/mcp' })])).toBeNull();
  });

  it('a press from MAWS’s own list whose entry is gone, replaced, or has no revision now is refused as changed', () => {
    expect(dynamicRefusal(PRESS, [held('fx-own')], [])).toBe(CHANGED);
    expect(dynamicRefusal(PRESS, [held('fx-own', { config: { type: 'http', url: NEW_URL } })], [own({ url: NEW_URL, revision: 'rev-2' })])).toBe(CHANGED);
    expect(dynamicRefusal(PRESS, [held('fx-own')], [own({ revision: null })])).toBe(CHANGED);
    const older: Record<string, unknown> = { ...own() };
    delete older.revision; // an engine host of an earlier build answers none
    expect(dynamicRefusal(PRESS, [held('fx-own')], [older as never])).toBe(CHANGED);
    // only MAWS's own entries count: a file entry of the name is not the list's
    expect(dynamicRefusal(PRESS, [held('fx-own')], [own({ scope: 'user', path: '/cfg/.claude.json' })])).toBe(CHANGED);
  });

  it('a press from MAWS’s own list in a session whose server is another configuration than the entry’s', () => {
    expect(dynamicRefusal(PRESS, [held('fx-own', { config: { type: 'http', url: NEW_URL } })], [own()])).toBe(OTHER);
    expect(dynamicRefusal(PRESS, [held('fx-own', { transport: 'sse', config: { type: 'sse', url: OWN_URL } })], [own()])).toBe(OTHER);
    expect(dynamicRefusal(PRESS, [{ name: 'fx-own', scope: 'dynamic' }], [own()])).toBe(OTHER); // says nothing of its configuration
  });
});
