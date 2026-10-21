// P4-R8 (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, routed as P4-R8): the MCP servers MAWS passes to every
// session it launches, and only to those: Settings › Engine › MCP servers (settings version 16, `engine.mcpServers`),
// handed to the engine as `--mcp-config` (X6's `mcpConfig`). An entry is an HTTP server by name and URL. Terminal
// sessions never see the list: it lives in MAWS's own settings, never in ~/.claude.json.
//
// What the engine does with it (spikes/protocol-probe/findings-p4-r8-mcp-servers.txt): the server reads as scope
// `dynamic`; an entry wins over the user's, a project's or the local scope's server of the same name, and only it is
// connected (the engine's own precedence, kept: MAWS passes its list and resolves nothing); and the engine keys a
// server's OAuth login by its name, type, URL and headers, never its scope, so an HTTP entry finds a terminal login
// made for the same name and URL without custom headers.
import * as z from 'zod';

// MAWS's own server, which the engine host answers (`sdkMcpServers`, src/shared/engine/initialize.ts); an entry under
// its name would shadow it (src/shared/maws/tools.ts MAWS_SERVER_NAME, which the test holds this to).
export const RESERVED_SERVER_NAME = 'maws';
export const MAX_APP_MCP_SERVERS = 32;
export const MAX_SERVER_URL = 2048;
// The engine's own rule for a server's name (`claude mcp add`: letters, digits, hyphens and underscores).
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
// Claude Code is the authority (2.1.304: m6, X3s/T0e); a name a later engine reserves is simply not loaded.
const ENGINE_RESERVED_SERVER_NAMES = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'hearthbot', 'remote-devices', 'claude_ai', 'widgets', 'Claude_Pages', 'Claude_Docs',
  'claude-in-chrome', 'computer-use', 'workspace', 'webagent', 'claude-code-remote', 'remote-browser', 'claude-device',
]);

const isServerUrl = (url: string): boolean => {
  if (!URL.canParse(url) || url.trim() !== url) return false; // refused rather than trimmed: validators never transform
  const { protocol, hostname } = new URL(url);
  return (protocol === 'https:' || protocol === 'http:') && hostname !== '';
};

export const AppMcpServerSchema = z.strictObject({
  name: z.string()
    .regex(NAME, { message: 'letters, digits, hyphens and underscores, at most 64' })
    .refine((name) => name !== RESERVED_SERVER_NAME, { message: `${RESERVED_SERVER_NAME} is MAWS's own server` })
    .refine((name) => !ENGINE_RESERVED_SERVER_NAMES.has(name), { message: 'reserved by Claude Code' }),
  type: z.literal('http'),
  url: z.string().max(MAX_SERVER_URL).refine(isServerUrl, { message: 'not an http or https URL' }),
});
export type AppMcpServer = z.infer<typeof AppMcpServerSchema>;

export const AppMcpServersSchema = z
  .array(AppMcpServerSchema)
  .max(MAX_APP_MCP_SERVERS)
  .refine((servers) => new Set(servers.map((s) => s.name)).size === servers.length, { message: 'two servers share a name' });

// The one place a launch reads the app's servers from: the `--mcp-config` object, or null when the list is empty so
// the launch line stays as it was.
export function appMcpConfig(servers: readonly AppMcpServer[]): { mcpServers: Record<string, { type: 'http'; url: string }> } | null {
  if (servers.length === 0) return null;
  return { mcpServers: Object.fromEntries(servers.map(({ name, type, url }) => [name, { type, url }])) };
}
