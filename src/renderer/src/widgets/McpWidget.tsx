// `/mcp` (C11 execution document, the widget table): `mcp_status`'s servers with their status, transport (`stdio ·
// <command>` or `http · <url>`), scope and source, an error when one is reported, and their tools as a count with a
// disclosure. It refetches when the session's MCP table in C3's status moves. M2 is the read half; M3 adds Reconnect
// and the persistent enable/disable switch as operations.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { McpStatusResponse } from '@shared/wire/control';
import { MCP, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Mono, parseEach, Row, Rows } from './parts';
import { MOVES_READS, useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const ConfigSchema = z.looseObject({ type: z.string().optional(), command: z.string().optional(), args: z.array(z.string()).optional(), url: z.string().optional() });
const ToolSchema = z.looseObject({ name: z.string() });

export interface McpServerView {
  name: string;
  status: string;
  transport: string | null;
  command: string | null; // the full stdio command line, for the tooltip
  scope: string | null;
  source: string | null;
  error: string | null;
  tools: string[];
}

// An absolute path in a command line shows as `…/<basename>`; the full line is in the tooltip.
const short = (part: string) => (part.includes('/') ? `…/${part.slice(part.lastIndexOf('/') + 1)}` : part);

function transportOf(raw: unknown): { transport: string | null; command: string | null } {
  const config = ConfigSchema.safeParse(raw);
  if (!config.success) return { transport: null, command: null };
  const { type, command, args = [], url } = config.data;
  if (command !== undefined) return { transport: `${type ?? 'stdio'} · ${[command, ...args].map(short).join(' ')}`, command: [command, ...args].join(' ') };
  if (url !== undefined) return { transport: `${type ?? 'http'} · ${url}`, command: null };
  return { transport: type ?? null, command: null };
}

export function present(answer: McpStatusResponse): { servers: McpServerView[] } {
  return {
    servers: answer.mcpServers.map((s) => ({
      name: s.name,
      status: s.status,
      ...transportOf(s.config),
      scope: typeof s.scope === 'string' ? s.scope : null,
      source: s.source ?? null,
      error: typeof s.error === 'string' ? s.error : null,
      tools: parseEach(ToolSchema, Array.isArray(s.tools) ? s.tools : []).map((t) => t.name),
    })),
  };
}

export function McpBody({ view }: { view: { servers: McpServerView[] } }) {
  if (view.servers.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{MCP.none}</p>;
  return (
    <Rows label={MCP.list}>
      {view.servers.map((s) => (
        <Row
          key={s.name}
          main={<span className="font-semibold">{s.name}</span>}
          note={<span className={s.status === 'connected' ? 'text-success' : s.status === 'failed' ? 'text-danger' : undefined}>{s.status}</span>}
          detail={
            <div className="flex flex-col gap-0.5">
              {s.transport && (
                <span title={s.command ?? undefined}>
                  <Mono>{s.transport}</Mono>
                </span>
              )}
              <span>{[s.scope && MCP.scope(s.scope), s.source && MCP.from(s.source)].filter(Boolean).join(' · ')}</span>
              {s.error && <span className="text-danger">{s.error}</span>}
              {s.tools.length > 0 && (
                <details>
                  <summary className="cursor-default">{MCP.tools(s.tools.length)}</summary>
                  <span className="font-mono text-ui-sm">{s.tools.join(', ')}</span>
                </details>
              )}
            </div>
          }
        />
      ))}
    </Rows>
  );
}

// A server's status in C3's table moving is reason to read `mcp_status` again.
const MOVES_MCP = (s: Parameters<typeof MOVES_READS>[0]) => `${MOVES_READS(s)}|${s.mcpServers.map((m) => `${m.name}=${m.status}`).join(',')}`;

export function McpWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.mcpStatus', { appSessionId }, { refreshOn: MOVES_MCP });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.mcp} command="mcp" foot={WIDGET_FOOT.mcp} state={read.state} error={read.error} close={close}>
      {read.data && <McpBody view={present(read.data)} />}
    </WidgetFrame>
  );
}
