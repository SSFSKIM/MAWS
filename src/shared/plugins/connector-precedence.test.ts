// Which configured entry of a name the engine uses (2.1.309 cli.pretty.js 720717, 720870, 720898; MAWS's own servers,
// loaded with --mcp-config as `dynamic`, 457558, and preferred by the authentication resolver, 853424): shared by
// Customize's rows (shadowed entries) and main's sign-in (the session must use the entry the row is, scalpel-2#1).
import { describe, expect, it } from 'vitest';
import { usedEntry } from './connector-precedence';

const at = (scope: 'app' | 'user' | 'project' | 'local', path = '/cfg/.claude.json', name = 'linear') => ({ name, scope, path });

describe('the entry the engine uses', () => {
  it('local over user over the nearest project file', () => {
    const user = at('user');
    const local = at('local');
    const outer = at('project', '/p/.mcp.json');
    const inner = at('project', '/p/app/.mcp.json');
    expect(usedEntry('linear', [user, outer, inner, local])).toBe(local);
    expect(usedEntry('linear', [user, outer, inner])).toBe(user);
    expect(usedEntry('linear', [outer, inner])).toBe(inner);
    expect(usedEntry('linear', [at('user', '/cfg/.claude.json', 'notion')])).toBeNull();
  });

  it('MAWS’s own server of the name over every file entry', () => {
    const app = at('app', '/maws/settings.json');
    expect(usedEntry('linear', [at('user'), app, at('local')])).toBe(app);
  });
});
