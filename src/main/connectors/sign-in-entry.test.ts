// scalpel-2#1: a sign-in runs only in a session whose engine uses the entry the row is. The engine is asked for a server
// by name alone, so a session whose directory has another entry of the name (a local override of a user server, MAWS's
// own server) would sign that one in, and its success would be shown on the wrong row.
import { describe, expect, it } from 'vitest';
import { entryRefusal } from './sign-in-entry';

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
