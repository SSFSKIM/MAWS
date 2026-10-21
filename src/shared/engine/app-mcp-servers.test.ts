// P4-R8 (2026-10-21): the app's HTTP servers, bounded at the settings boundary and mapped to the engine's launch flag.
import { describe, expect, it } from 'vitest';
import { MAWS_SERVER_NAME } from '../maws/tools';
import { AppMcpServerSchema, AppMcpServersSchema, appMcpConfig, RESERVED_SERVER_NAME } from './app-mcp-servers';

const notion = { name: 'notion', type: 'http' as const, url: 'https://mcp.notion.com/mcp' };
const loopback = { name: 'local_tools-1', type: 'http' as const, url: 'http://127.0.0.1:8765/mcp' };

describe('the app MCP servers', () => {
  it('accepts the owner’s Notion entry and a loopback HTTP server unchanged', () => {
    expect(AppMcpServerSchema.parse(notion)).toEqual(notion);
    expect(AppMcpServerSchema.parse(loopback)).toEqual(loopback);
    expect(AppMcpServersSchema.parse([notion, loopback])).toEqual([notion, loopback]);
    expect(RESERVED_SERVER_NAME).toBe(MAWS_SERVER_NAME);
  });

  it.each(['maws', 'two words', 'with.dot', '', 'x'.repeat(65)])('refuses the name %j', (name) => {
    expect(AppMcpServerSchema.safeParse({ ...notion, name }).success).toBe(false);
  });

  it.each([
    ...Object.getOwnPropertyNames(Object.prototype),
    'hearthbot', 'remote-devices', 'claude_ai', 'widgets', 'Claude_Pages', 'Claude_Docs',
    'claude-in-chrome', 'computer-use', 'workspace', 'webagent', 'claude-code-remote', 'remote-browser', 'claude-device',
  ])('refuses %j as reserved by Claude Code', (name) => {
    const parsed = AppMcpServerSchema.safeParse({ ...notion, name });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe('reserved by Claude Code');
  });

  it('accepts a name at the 64-character bound', () => {
    expect(AppMcpServerSchema.safeParse({ ...notion, name: 'x'.repeat(64) }).success).toBe(true);
  });

  it.each(['file:///tmp/mcp', 'ftp://example.test/mcp', ' https://mcp.notion.com/mcp', 'https://mcp.notion.com/mcp ', 'not a URL'])('refuses the URL %j rather than trimming it', (url) => {
    expect(AppMcpServerSchema.safeParse({ ...notion, url }).success).toBe(false);
  });

  it('accepts a URL at 2048 characters and refuses one past the bound', () => {
    const url = `https://example.test/${'x'.repeat(2048 - 'https://example.test/'.length)}`;
    expect(AppMcpServerSchema.safeParse({ ...notion, url }).success).toBe(true);
    expect(AppMcpServerSchema.safeParse({ ...notion, url: `${url}x` }).success).toBe(false);
  });

  it('takes HTTP transport only and refuses unrecognized fields', () => {
    expect(AppMcpServerSchema.safeParse({ ...notion, type: 'stdio' }).success).toBe(false);
    expect(AppMcpServerSchema.safeParse({ ...notion, headers: {} }).success).toBe(false);
  });

  it('refuses duplicate names even when their URLs differ', () => {
    expect(AppMcpServersSchema.safeParse([notion, { ...loopback, name: notion.name }]).success).toBe(false);
  });

  it('accepts 32 distinct servers and refuses 33', () => {
    const servers = Array.from({ length: 32 }, (_, i) => ({ ...loopback, name: `server-${i}` }));
    expect(AppMcpServersSchema.safeParse(servers).success).toBe(true);
    expect(AppMcpServersSchema.safeParse([...servers, notion]).success).toBe(false);
  });

  it('omits the flag for an empty list and maps a list to the --mcp-config object in order', () => {
    expect(appMcpConfig([])).toBeNull();
    const config = appMcpConfig([notion, loopback]);
    expect(config).toEqual({ mcpServers: {
      notion: { type: 'http', url: notion.url },
      'local_tools-1': { type: 'http', url: loopback.url },
    } });
    expect(Object.keys(config!.mcpServers)).toEqual(['notion', 'local_tools-1']);
  });
});
