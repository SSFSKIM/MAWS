// scalpel-2#1: a sign-in runs only in a session whose engine uses the entry the row is. The engine is asked for a server
// by name alone, so a session whose directory has another entry of the name (a local override of a user server, MAWS's
// own server) would sign that one in, and its success would be shown on the wrong row.
import { describe, expect, it } from 'vitest';
import { entryRefusal } from './sign-in-entry';

const GLOBAL = '/cfg/.claude.json';
const user = { name: 'linear', scope: 'user', path: GLOBAL } as const;
const local = { name: 'linear', scope: 'local', path: GLOBAL } as const;

describe('the session’s entry for a sign-in', () => {
  it('is the requested one: nothing to refuse', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user])).toBeNull();
    expect(entryRefusal({ ...local, cwd: '/p' }, '/p', [user, local])).toBeNull();
    expect(entryRefusal({ name: 'linear', scope: 'project', path: '/p/.mcp.json', cwd: '/p' }, '/p', [{ name: 'linear', scope: 'project', path: '/p/.mcp.json' }])).toBeNull();
  });

  it('is another: a local override, MAWS’s own server, a nearer project file, or none at all', () => {
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user, local])).toBe(`that session uses the local entry in ${GLOBAL}`);
    expect(entryRefusal({ ...user, cwd: null }, '/p', [user, { name: 'linear', scope: 'app', path: '/maws/settings.json' }])).toBe('that session uses MAWS’s linear server');
    expect(entryRefusal({ name: 'linear', scope: 'project', path: '/p/.mcp.json', cwd: '/p/app' }, '/p/app', [{ name: 'linear', scope: 'project', path: '/p/.mcp.json' }, { name: 'linear', scope: 'project', path: '/p/app/.mcp.json' }])).toBe('that session uses the project entry in /p/app/.mcp.json');
    expect(entryRefusal({ ...user, cwd: null }, '/p', [])).toBe('that session has no linear entry');
  });

  it('a local entry is its project’s: a session in another directory does not use it', () => {
    expect(entryRefusal({ ...local, cwd: '/p' }, '/q', [user, local])).toBe('that session runs in /q, not /p');
  });
});
