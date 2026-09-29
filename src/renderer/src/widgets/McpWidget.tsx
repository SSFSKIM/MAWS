// `/mcp` (C11 execution document, the widget table): `mcp_status`'s servers with their status, transport (`stdio ·
// <command>` or `http · <url>`), scope and source, an error when one is reported, and their tools as a count with a
// disclosure. It refetches when the session's MCP table in C3's status moves. Each server offers Reconnect (for this
// session) and the enable switch, which the engine records for the project in ~/.claude.json (said beside the switch
// and in the foot); both run as operations, and the switch's position after either outcome is the next read's.
import { useRef, useState } from 'react';
import * as z from 'zod';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { McpStatusResponse } from '@shared/wire/control';
import { useSessions } from '../stores/sessions';
import { MCP, MCP_ACTIONS, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { operationLine, outcomeWords, useOperation } from './operation';
import { Mono, parseEach, Row, Rows, TextButton } from './parts';
import { MOVES_READS, useEngineRead, type EngineRead } from './read';
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

// ---- the actions (M3): Reconnect for this session, and the enable switch the engine records in ~/.claude.json ----------

type Outcome = OperationEvent['outcome'];
type ReadBack = { status: string; error: string | null } | null | 'unread'; // the server in the read; absent; the read failed
export interface ToggleView {
  position: 'on' | 'off' | 'unconfirmed';
  line: string | null;
}

// The refusals `mcp_toggle` throws before it writes anything (cli.pretty.js 2.1.283:583725–583733): only these leave the
// persisted state where it stood, so only after these is a read that disagrees with the request not a doubt.
const BEFORE_THE_WRITE = /^Server not found: |is blocked by enterprise managed policy|is not approved for this project|^mcp_toggle: /;
const positionOf = (status: string): 'on' | 'off' => (status === 'disabled' ? 'off' : 'on');
const toggleWords = (outcome: Outcome) => outcomeWords(outcome, () => MCP_ACTIONS.done);

// Where the switch stands after a toggle's outcome, from the read that followed it and never from the outcome: the engine
// writes the toggle before it connects or cleans up, so an error says nothing about what was persisted (Interfaces,
// "The toggle is read back, never inferred").
export function toggleView(requested: boolean, outcome: Outcome, read: ReadBack): ToggleView {
  const unconfirmed = { position: 'unconfirmed' as const, line: MCP_ACTIONS.unconfirmed(toggleWords(outcome)) };
  if (read === 'unread' || read === null) return unconfirmed;
  const position = positionOf(read.status);
  const words = read.status === 'failed' ? MCP_ACTIONS.notConnected(read.error ?? toggleWords(outcome)) : toggleWords(outcome);
  if (!outcome.ok && BEFORE_THE_WRITE.test(outcome.error.message)) return { position, line: words };
  return position === (requested ? 'on' : 'off') ? { position, line: words } : unconfirmed;
}

const SWITCH = 'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-border outline-accent focus-visible:outline-2 disabled:opacity-50';

function McpServerRow({ server, appSessionId, ready, answer, refresh }: { server: McpServerView; appSessionId: AppSessionId; ready: boolean; answer: McpStatusResponse; refresh: EngineRead<McpStatusResponse>['refresh'] }) {
  const [last, setLast] = useState<'reconnect' | 'toggle' | null>(null);
  // the toggle's view, from the read that followed its outcome (`basis`: the answer that read produced)
  const [toggled, setToggled] = useState<(ToggleView & { basis: McpStatusResponse | undefined }) | null>(null);
  const asked = useRef<{ requested: boolean; outcome: Outcome } | null>(null);
  const readBack = async () => {
    if (!asked.current) return;
    const { requested, outcome } = asked.current;
    const { data, failed } = await refresh();
    const entry = failed ? 'unread' : (data?.mcpServers.find((s) => s.name === server.name) ?? null);
    setToggled({ ...toggleView(requested, outcome, entry === 'unread' || entry === null ? entry : { status: entry.status, error: typeof entry.error === 'string' ? entry.error : null }), basis: data });
  };
  const reconnect = useOperation(appSessionId, 'session.mcpReconnect');
  // a late completion corrects the outcome, and the switch is read back again
  const toggle = useOperation(appSessionId, 'session.mcpToggle', (outcome) => {
    if (asked.current) asked.current = { ...asked.current, outcome };
    void readBack();
  });
  const busy = reconnect.state.phase === 'working' || toggle.state.phase === 'working';

  // Any later answer (a status move, a manual read) reconciles; until one arrives, the toggle's view holds.
  const view = toggled && toggled.basis === answer ? toggled : null;
  const position = view?.position ?? positionOf(server.status);
  const settledLine = view?.line ?? (server.status === 'failed' ? MCP_ACTIONS.notConnected(server.error ?? server.status) : null);
  const line = last === 'reconnect' ? operationLine(reconnect.state, () => MCP_ACTIONS.reconnected) : toggle.state.phase === 'settled' ? settledLine : (operationLine(toggle.state, () => MCP_ACTIONS.done) ?? settledLine);

  const flip = async () => {
    setLast('toggle');
    setToggled(null);
    const requested = position !== 'on';
    asked.current = null;
    const outcome = await toggle.run({ serverName: server.name, enabled: requested });
    if (!outcome) return;
    asked.current = { requested, outcome };
    await readBack();
  };
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={position === 'on'}
          aria-label={MCP_ACTIONS.enabled(server.name)}
          data-state={position}
          disabled={!ready || busy}
          onClick={() => void flip()}
          className={`${SWITCH} ${position === 'on' ? 'bg-accent' : 'bg-bg-active'}`}
        >
          <span aria-hidden className={`absolute size-3 rounded-full bg-bg-raised ${position === 'on' ? 'right-0.5' : position === 'off' ? 'left-0.5' : 'left-1.5'}`} />
        </button>
        <span className="min-w-0 flex-1 text-ui-sm text-fg-muted">{MCP_ACTIONS.persisted}</span>
        <TextButton
          onClick={() => {
            setLast('reconnect');
            void reconnect.run({ serverName: server.name });
          }}
          disabled={!ready || busy}
        >
          {MCP_ACTIONS.reconnect}
        </TextButton>
      </div>
      {line !== null && (
        <span role="status" className={`text-ui-sm ${position === 'unconfirmed' ? 'text-warning' : 'text-fg-muted'}`}>
          {line}
        </span>
      )}
      {view?.position === 'unconfirmed' && (
        <span>
          <TextButton onClick={() => void readBack()}>{MCP_ACTIONS.readAgain}</TextButton>
        </span>
      )}
    </div>
  );
}

export function McpBody({ view, actions }: { view: { servers: McpServerView[] }; actions?: { appSessionId: AppSessionId; ready: boolean; answer: McpStatusResponse; refresh: EngineRead<McpStatusResponse>['refresh'] } }) {
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
              {actions && <McpServerRow server={s} {...actions} />}
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
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.mcp} command="mcp" foot={WIDGET_FOOT.mcp} state={read.state} error={read.error} close={close}>
      {read.data && <McpBody view={present(read.data)} actions={{ appSessionId, ready, answer: read.data, refresh: read.refresh }} />}
    </WidgetFrame>
  );
}
