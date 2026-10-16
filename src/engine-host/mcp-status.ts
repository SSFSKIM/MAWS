// What `session.mcpStatus` answers the renderer (P3 Decision Log 24's residue). The engine's mcp_status reports each
// server's config with an HTTP server's header values verbatim after env expansion (spikes/p3-connectors/findings.txt
// §1; engine-mcp-call.jsonl seq 5), and the SDK's config union also carries a stdio server's `env`, a remote server's
// `headersHelper` and OAuth settings. The renderer shows a server's transport only (src/renderer/src/widgets/
// McpWidget.tsx), so its answer keeps the four fields that line is made of and drops every other config field, a field
// the engine adds later included. The engine's own answer stays whole for main-only consumers in the host.
import type { McpStatusResponse } from '@shared/wire/control';

const RENDERER_CONFIG_FIELDS = ['type', 'command', 'args', 'url'] as const;

function rendererConfig(config: unknown): Record<string, unknown> | undefined {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined;
  const kept: Record<string, unknown> = {};
  for (const field of RENDERER_CONFIG_FIELDS) if (Object.hasOwn(config, field)) kept[field] = (config as Record<string, unknown>)[field];
  return kept;
}

export function rendererMcpStatus(answer: McpStatusResponse): McpStatusResponse {
  return {
    ...answer,
    mcpServers: answer.mcpServers.map(({ config, ...server }) => {
      const kept = rendererConfig(config);
      return kept === undefined ? server : { ...server, config: kept };
    }),
  };
}
