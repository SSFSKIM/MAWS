// `/mcp` (C11 execution document, the widget table): `mcp_status`'s servers with their status, transport (`stdio ·
// <command>` or `http · <url>`), scope and source, an error when one is reported, and their tools as a count with a
// disclosure. It refetches when the session's MCP table in C3's status moves. Each server offers Reconnect (for this
// session) and the enable switch, which the engine records for the project in ~/.claude.json (said beside the
// switch); both run as operations, and the switch's position after either outcome is the next read's.
// P5 O7 M8 ("Sign in from the session's MCP widget"): a server that needs auth also offers Sign in, for a session on this Mac
// or another machine alike: by its name and scope (`connectors.signInServer`, the entry read on the session's machine),
// with the session's directory, its progress and result in Customize's words (customize/connectors/sign-in.ts).
// Reconnect stays a restart. Each control is greyed, with its reason, for a session on a machine that doesn't offer its
// command (lane-b/remote-unavailable.ts: an older machine heard refusing it).
import { useRef, useState } from 'react';
import * as z from 'zod';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { McpStatusResponse } from '@shared/wire/control';
import { PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { CONNECTORS } from '../customize/connectors/copy';
import { signInViewOf } from '../customize/connectors/present';
import { signInKeyOf, signInMachineOf, startSignInByName, useSignIns } from '../customize/connectors/sign-in';
import { useSessionControls } from '../session/controls/controls-for'; // P5 O9 M5
import { useSessions } from '../stores/sessions';
import { McpDriven } from './McpDriven'; // P5 O9 M5
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { MCP, MCP_ACTIONS, WIDGET_TITLE } from './copy';
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

// P5 O7 M8: a scope the engine signs a server in from (its configuration files'); `dynamic`, `claudeai` and the managed
// scopes are signed in nowhere a session reaches
const signInScope = (scope: string | null): PluginsScope | null => (PLUGINS_SCOPES as readonly (string | null)[]).includes(scope) ? (scope as PluginsScope) : null;

// P5 O7 M8: Sign in on a server that needs auth, and the line its sign-in says (Customize's words); none before one ran
function SignIn({ server, appSessionId, cwd, readAt }: { server: McpServerView; appSessionId: AppSessionId; cwd: string | null; readAt: number | null }) {
  const scope = signInScope(server.scope);
  const target = scope === null || (scope !== 'user' && cwd === null) ? null : { name: server.name, scope, cwd };
  const record = useSignIns((s) => (target === null ? null : (s.byServer.get(signInKeyOf({ ...target, machine: signInMachineOf(appSessionId) })) ?? null)));
  const unavailable = useRemoteUnavailable(appSessionId, 'connectors.signInServer'); // an older machine's refusal
  if (target === null) return null;
  const live = { status: server.status, error: server.error };
  const line = record === null ? null : signInViewOf({ live, liveRead: readAt === null ? null : { appSessionId, at: readAt }, posture: null, last: record, transport: null })?.text;
  return (
    <>
      {server.status === 'needs-auth' && (
        <button type="button" aria-label={CONNECTORS.signInName(server.name)} disabled={unavailable !== null} title={unavailable ?? undefined} onClick={() => void startSignInByName(target, appSessionId)} className={SIGN_IN}>
          {CONNECTORS.signIn}
        </button>
      )}
      {line && (
        <span data-sign-in-state className="min-w-0 text-ui-sm text-fg-muted">
          {line}
        </span>
      )}
    </>
  );
}
const SIGN_IN = 'shrink-0 rounded-sm px-1 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

function McpServerRow({ server, appSessionId, ready, answer, refresh, cwd, readAt }: { server: McpServerView; appSessionId: AppSessionId; ready: boolean; answer: McpStatusResponse; refresh: EngineRead<McpStatusResponse>['refresh']; cwd: string | null; readAt: number | null }) {
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
  const lastRead = positionOf(server.status); // the answer held is the last read that succeeded
  const position = view?.position ?? lastRead;
  const checked = (position === 'unconfirmed' ? lastRead : position) === 'on'; // role=switch has no "mixed": the doubt is in data-state and the line
  const settledLine = view?.line ?? (server.status === 'failed' ? MCP_ACTIONS.notConnected(server.error ?? server.status) : null);
  const line = last === 'reconnect' ? operationLine(reconnect.state, () => MCP_ACTIONS.reconnected) : toggle.state.phase === 'settled' ? settledLine : (operationLine(toggle.state, () => MCP_ACTIONS.done) ?? settledLine);

  const flip = async () => {
    setLast('toggle');
    setToggled(null);
    const requested = !checked;
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
          aria-checked={checked}
          aria-label={MCP_ACTIONS.enabled(server.name)}
          data-state={position}
          disabled={!ready || busy || toggle.unavailable !== null}
          title={toggle.unavailable ?? undefined}
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
          disabled={!ready || busy || reconnect.unavailable !== null}
          title={reconnect.unavailable ?? undefined}
        >
          {MCP_ACTIONS.reconnect}
        </TextButton>
        <SignIn server={server} appSessionId={appSessionId} cwd={cwd} readAt={readAt} />
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

export function McpBody({ view, actions, compact = false }: { view: { servers: McpServerView[] }; compact?: boolean; actions?: { appSessionId: AppSessionId; ready: boolean; answer: McpStatusResponse; refresh: EngineRead<McpStatusResponse>['refresh']; cwd: string | null; readAt: number | null } }) {
  if (view.servers.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{MCP.none}</p>;
  if (compact) return <ul aria-label={MCP.list} className="m-0 list-none p-0">
    {view.servers.map((server) => <li key={`${server.name}:${server.scope}:${server.source}`} className="border-b border-border px-2 py-2 last:border-b-0">
      <details>
        <summary className="cursor-default rounded-sm text-ui outline-accent focus-visible:outline-2">
          <span className="font-medium [overflow-wrap:anywhere]">{server.name}</span>
          <span className="ml-2 text-ui-sm text-fg-muted">{server.status}{server.tools.length > 0 ? ` · ${MCP.tools(server.tools.length)}` : ''}{server.scope ? ` · ${server.scope}` : ''}</span>
        </summary>
        <div className="flex flex-col gap-1 pt-2 text-ui-sm text-fg-muted [overflow-wrap:anywhere]">
          {server.transport && <span>{server.transport}</span>}
          {server.source && <span>{server.source}</span>}
          {server.error && <span className="text-danger">{server.error}</span>}
          {server.tools.length > 0 && <span className="font-mono">{server.tools.join(', ')}</span>}
        </div>
      </details>
    </li>)}
  </ul>;
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

export function McpWidget(props: { appSessionId: AppSessionId; args: string; close(): void }) {
  const controls = useSessionControls(props.appSessionId); // P5 O9 M5: a session driven through its bridge reads the bridge
  return controls && controls.turn() !== null ? <McpDriven appSessionId={props.appSessionId} controls={controls} close={props.close} /> : <McpEngine {...props} />;
}

function McpEngine({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.mcpStatus', { appSessionId }, { refreshOn: MOVES_MCP });
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null); // P5 O7 M8: a server's identity, with its name and scope
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.mcp} command="mcp" state={read.state} error={read.error} readAt={read.readAt} close={close}>
      {read.data && <McpBody view={present(read.data)} actions={{ appSessionId, ready, answer: read.data, refresh: read.refresh, cwd, readAt: read.readAt }} />}
    </WidgetFrame>
  );
}
