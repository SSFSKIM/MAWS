// `/mcp` (C11 execution document, the widget table): `mcp_status`'s servers with their status, transport (`stdio ·
// <command>` or `http · <url>`), scope and source, an error when one is reported, and their tools as a count with a
// disclosure. It refetches when the session's MCP table in C3's status moves. Each server offers Reconnect (for this
// session) and the enable switch, which the engine records in ~/.claude.json (U11a: said once, in the head); both run
// as operations, and the switch's position after either outcome is the next read's.
// P5 O7 M8 ("Sign in from the session's MCP widget"): a server that needs auth also offers Sign in, for a session on this Mac
// or another machine alike: by its name and scope (`connectors.signInServer`, the entry read on the session's machine),
// with the session's directory, its progress and result in Customize's words (customize/connectors/sign-in.ts).
// Reconnect stays a restart. Each control is greyed, with its reason, for a session on a machine that doesn't offer its
// command (lane-b/remote-unavailable.ts: an older machine heard refusing it).
// UX wave U11a (§C, l8-settings-04): the dialog is Connectors, with "MCP servers" muted beside the title. Each connector
// is one line (`ConnectorRow`): the switch, the name, the status in words (connector-status.ts) and the tool count;
// opening the row shows the rest. Sign in and Reconnect sit on the line of a row that needs a sign-in or failed, and
// Reconnect is in the opened part of any other. What the switch reaches is said once, in the head, never on a row.
// U11a M8 (§A): a dynamic connector that needs a sign-in, a plugin's or one of MAWS's own list, offers Sign in too, by its
// name (`connectors.signInDynamicServer`); for a session on another machine it is drawn disabled with U9's sentence until
// U11f, a file-scope row beside it keeping its own.
// U11a (§D, l8-settings-03): before the first message on this Mac the dialog lists the folder's configured connectors,
// one row per name (the entry the engine will use) with its scope in place of a status, and no switch, Reconnect or Sign
// in; for a tab set to another machine it says the list shows once the chat starts there.
import { useId, useRef, useState, type ReactNode } from 'react';
import * as z from 'zod';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { McpStatusResponse } from '@shared/wire/control';
import { PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { CONNECTORS } from '../customize/connectors/copy';
import { serverKey, signInViewOf, usedEntries } from '../customize/connectors/present';
import { useCustomizationInventory } from '../customize/inventory';
import { InventoryState } from '../customize/InventoryState';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { signInKeyOf, signInMachineOf, signsInDynamic, startSignInByName, startSignInDynamic, useSignIns, type SignInServer } from '../customize/connectors/sign-in';
import { useSessionControls } from '../session/controls/controls-for'; // P5 O9 M5
import { useSessions } from '../stores/sessions';
import { useCommand } from '../ipc/query';
import { machineFor, pathTarget } from '../ipc/machine';
import { homeAbbreviated } from '../tools/session-info/model';
import { connectorStatusWords } from './connector-status';
import { McpDriven } from './McpDriven'; // P5 O9 M5
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { BEFORE_START, MCP, MCP_ACTIONS, WIDGET_TITLE } from './copy';
import { operationLine, outcomeWords, useOperation } from './operation';
import { Mono, parseEach, Rows, TextButton } from './parts';
import { MOVES_READS, useEngineRead, type EngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';
import { useCloseOnLeavingForRemote, useTabPlace, type TabPlace } from './tab-place';

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

const SWITCH = 'relative mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-border outline-accent focus-visible:outline-2 disabled:opacity-50';
const DISCLOSURE = 'flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 rounded-sm text-left outline-accent focus-visible:outline-2';
const tone = (status: string) => (status === 'connected' ? 'text-success' : status === 'failed' ? 'text-danger' : 'text-fg-muted');

// U11a (§C, "The row"): one connector on one line. The switch (`control`) stands before the disclosure and the line's
// `actions` after it, so a press on either never opens the row. Opened: the transport (the full command as its tooltip),
// where it comes from, its scope, an error, the tool names, then `opened`. `words` is the status in words, or what a
// list before the first message says in their place; `under` is the answer of an act on the row, drawn whether the row
// is open or not. M7 and M8 build on it.
export function ConnectorRow({ server, words, control, actions, opened, under }: { server: McpServerView; words: string; control?: ReactNode; actions?: ReactNode; opened?: ReactNode; under?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const part = useId();
  const tools = server.tools.length > 0 ? MCP.tools(server.tools.length) : '';
  const where = [server.source && MCP.from(server.source), server.scope && MCP.scope(server.scope)].filter(Boolean).join(' · ');
  return (
    <li data-mcp-server={server.name} className="flex flex-col gap-0.5 border-t border-border py-1 text-ui-sm first:border-t-0">
      <div className="flex min-w-0 items-start gap-2">
        {control}
        <button type="button" aria-expanded={open} aria-controls={open ? part : undefined} onClick={() => setOpen(!open)} className={DISCLOSURE}>
          <span data-connector-name className="min-w-0 font-medium [overflow-wrap:anywhere]">
            {server.name}
          </span>
          {(words !== '' || tools !== '') && (
            <span data-connector-state className="shrink-0 text-fg-muted">
              {words !== '' && <span className={tone(server.status)}>{words}</span>}
              {words !== '' && tools !== '' && ' · '}
              {tools}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && (
        <div id={part} className="flex flex-col gap-0.5 text-fg-muted [overflow-wrap:anywhere]">
          {server.transport && (
            <span title={server.command ?? undefined}>
              <Mono>{server.transport}</Mono>
            </span>
          )}
          {where !== '' && <span>{where}</span>}
          {server.error && <span className="text-danger">{server.error}</span>}
          {server.tools.length > 0 && <span className="font-mono">{server.tools.join(', ')}</span>}
          {opened}
        </div>
      )}
      {under}
    </li>
  );
}

// P5 O7 M8: a scope the engine signs a server in from (its configuration files'); U11a M8: and `dynamic`, a plugin's or
// one of MAWS's own list, of a name the command takes. `claudeai` and the managed scopes are signed in nowhere a session
// reaches.
const signInScope = (scope: string | null): PluginsScope | null => (PLUGINS_SCOPES as readonly (string | null)[]).includes(scope) ? (scope as PluginsScope) : null;
function signInTargetOf(server: McpServerView, cwd: string | null): Omit<SignInServer, 'machine'> | null {
  if (server.scope === 'dynamic') return signsInDynamic(server.name) ? { name: server.name, scope: 'dynamic', cwd: null } : null;
  const scope = signInScope(server.scope);
  return scope === null || (scope !== 'user' && cwd === null) ? null : { name: server.name, scope, cwd };
}

// P5 O7 M8: Sign in on a server that needs auth, and the line its sign-in says (Customize's words); none before one ran.
// U11a: the button sits on the row's line, the line under the row.
function useSignIn({ server, appSessionId, cwd, readAt }: { server: McpServerView; appSessionId: AppSessionId; cwd: string | null; readAt: number | null }): { button: ReactNode; line: string | null } {
  const target = signInTargetOf(server, cwd);
  const record = useSignIns((s) => (target === null ? null : (s.byServer.get(signInKeyOf({ ...target, machine: signInMachineOf(appSessionId) })) ?? null)));
  // a command the machine does not take: declared (U9's `REMOTE_UNAVAILABLE`), or an older machine's refusal
  const unavailable = useRemoteUnavailable(appSessionId, target?.scope === 'dynamic' ? 'connectors.signInDynamicServer' : 'connectors.signInServer');
  if (target === null) return { button: null, line: null };
  const live = { status: server.status, error: server.error };
  const line = record === null ? null : (signInViewOf({ live, liveRead: readAt === null ? null : { appSessionId, at: readAt }, posture: null, last: record, transport: null })?.text ?? null);
  const button =
    server.status === 'needs-auth' ? (
      <button type="button" aria-label={CONNECTORS.signInName(server.name)} disabled={unavailable !== null} title={unavailable ?? undefined} onClick={() => void (target.scope === 'dynamic' ? startSignInDynamic({ name: target.name }, null, appSessionId) : startSignInByName({ ...target, scope: target.scope }, appSessionId))} className={SIGN_IN}>
        {CONNECTORS.signIn}
      </button>
    ) : null;
  return { button, line: line || null };
}
const SIGN_IN = 'shrink-0 rounded-sm px-1 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

// Reconnect sits on the line of a row that needs a sign-in or failed, and in the opened part of any other (U11a).
const RECONNECT_ON_LINE = new Set(['needs-auth', 'failed']);

// `reachSaid`: the head says what the switch reaches; until it can, the switch waits (Reconnect reaches this session only)
function McpServerRow({ server, appSessionId, ready, answer, refresh, cwd, readAt, reachSaid }: { server: McpServerView; appSessionId: AppSessionId; ready: boolean; answer: McpStatusResponse; refresh: EngineRead<McpStatusResponse>['refresh']; cwd: string | null; readAt: number | null; reachSaid: boolean }) {
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
  const signIn = useSignIn({ server, appSessionId, cwd, readAt });
  const busy = reconnect.state.phase === 'working' || toggle.state.phase === 'working';

  // Any later answer (a status move, a manual read) reconciles; until one arrives, the toggle's view holds.
  const view = toggled && toggled.basis === answer ? toggled : null;
  const lastRead = positionOf(server.status); // the answer held is the last read that succeeded
  const position = view?.position ?? lastRead;
  const checked = (position === 'unconfirmed' ? lastRead : position) === 'on'; // role=switch has no "mixed": the doubt is in data-state and the line
  // U11a: a failed row with nothing done says Failed on its line and its error in the opened part, with no line under it
  const settledLine = view?.line ?? null;
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
  const reconnectButton = (
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
  );
  const onLine = RECONNECT_ON_LINE.has(server.status);
  return (
    <ConnectorRow
      server={server}
      words={connectorStatusWords(server.status, { switchDrawn: true })}
      control={
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={MCP_ACTIONS.enabled(server.name)}
          data-state={position}
          disabled={!ready || !reachSaid || busy || toggle.unavailable !== null}
          title={toggle.unavailable ?? undefined}
          onClick={() => void flip()}
          className={`${SWITCH} ${position === 'on' ? 'bg-accent' : 'bg-bg-active'}`}
        >
          <span aria-hidden className={`absolute size-3 rounded-full bg-bg-raised ${position === 'on' ? 'right-0.5' : position === 'off' ? 'left-0.5' : 'left-1.5'}`} />
        </button>
      }
      actions={
        <>
          {signIn.button}
          {onLine && reconnectButton}
        </>
      }
      opened={onLine ? undefined : <span>{reconnectButton}</span>}
      under={
        <>
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
          {signIn.line !== null && (
            <span data-sign-in-state className="min-w-0 text-ui-sm text-fg-muted">
              {signIn.line}
            </span>
          )}
        </>
      }
    />
  );
}

// The list of a session's connectors. With `actions`, each row is the dialog's (switch, Sign in, Reconnect); without,
// the row has none and a disabled connector reads Off (Customize's live list).
export function McpBody({ view, actions }: { view: { servers: McpServerView[] }; actions?: { appSessionId: AppSessionId; ready: boolean; answer: McpStatusResponse; refresh: EngineRead<McpStatusResponse>['refresh']; cwd: string | null; readAt: number | null; reachSaid: boolean } }) {
  if (view.servers.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{MCP.none}</p>;
  return (
    <Rows label={MCP.list}>
      {view.servers.map((server) => {
        const key = `${server.name}:${server.scope}:${server.source}`;
        return actions ? <McpServerRow key={key} server={server} {...actions} /> : <ConnectorRow key={key} server={server} words={connectorStatusWords(server.status)} />;
      })}
    </Rows>
  );
}

// U11a (§C, "<place>"; P2, spikes/protocol-probe/findings-uxwave-u11-connector-off-place.txt): where the switch reaches.
// The engine records it under the key of the repository's main root, from the root, a linked worktree and a subfolder
// alike, and outside any repository under the folder exactly. So: the project's name when the session's record names
// one; else the main root of the repository holding the session's folder (`git.worktree.list`'s `repoRoot`, the parent
// of its common dir), the home abbreviated; else, in no repository or where git answers nothing, the folder itself.
// Null, and no sentence, while the main root is being read; the switch waits for the sentence (`reachSaid`).
function useSwitchPlace(appSessionId: AppSessionId, folder: string | null): string | null {
  const project = useSessions((s) => {
    const id = s.records.get(appSessionId)?.projectId;
    return id ? (s.projects.get(id)?.name ?? null) : null;
  });
  const main = useCommand('git.worktree.list', { repoRoot: folder ?? '' }, { enabled: project === null && folder !== null }, pathTarget(machineFor(appSessionId), appSessionId));
  if (project !== null) return project;
  if (folder === null || main.isPending) return null;
  return homeAbbreviated(main.data?.repoRoot ?? folder);
}

// A server's status in C3's table moving is reason to read `mcp_status` again.
const MOVES_MCP = (s: Parameters<typeof MOVES_READS>[0]) => `${MOVES_READS(s)}|${s.mcpServers.map((m) => `${m.name}=${m.status}`).join(',')}`;

export function McpWidget(props: { appSessionId: AppSessionId; args: string; close(): void }) {
  const place = useTabPlace(props.appSessionId); // U11a: an unstarted tab's dialog branches before the frame's read
  useCloseOnLeavingForRemote(place, props.close);
  const controls = useSessionControls(props.appSessionId); // P5 O9 M5: a session driven through its bridge reads the bridge
  if (place.kind !== 'started') return <McpBeforeStart appSessionId={props.appSessionId} place={place} close={props.close} />;
  return controls && controls.turn() !== null ? <McpDriven appSessionId={props.appSessionId} controls={controls} close={props.close} /> : <McpEngine {...props} />;
}

// U11a (§D "Connectors"): a configured server as the row draws it before the start: the scope stands on the line in
// Customize's words, so the opened part holds the transport and the file that configures it.
const configuredView = (server: CustomizationServer): McpServerView => ({ name: server.name, status: '', transport: server.transport === 'unknown' ? null : server.transport, command: null, scope: null, source: null, error: null, tools: [] });

function McpBeforeStart({ appSessionId, place, close }: { appSessionId: AppSessionId; place: Exclude<TabPlace, { kind: 'started' }>; close(): void }) {
  const local = place.kind === 'local';
  const inventory = useCustomizationInventory(local ? place.folder : null, { enabled: local });
  const servers = inventory.data ? usedEntries(inventory.data.servers) : null;
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.mcp} subtitle={MCP.subtitle} command="mcp" state="ready" error={null} close={close}>
      {place.kind === 'remote' ? (
        <p className="m-0 text-fg-muted">{BEFORE_START.remote(place.machine)}</p>
      ) : (
        <>
          <p data-before-start className="m-0 mb-1 text-ui-sm text-fg-muted">
            {BEFORE_START.connectors(place.place)}
          </p>
          <InventoryState error={inventory.error} pending={inventory.isPending} warnings={inventory.data?.warnings} refresh={() => void inventory.refetch()} />
          {servers !== null &&
            (servers.length === 0 ? (
              <p className="m-0 text-ui-sm text-fg-muted">{MCP.none}</p>
            ) : (
              <Rows label={MCP.list}>
                {servers.map((server) => (
                  <ConnectorRow key={serverKey(server)} server={configuredView(server)} words={CONNECTORS.scopeOf(server.scope)} opened={<span title={server.path}>{homeAbbreviated(server.path)}</span>} />
                ))}
              </Rows>
            ))}
        </>
      )}
    </WidgetFrame>
  );
}

function McpEngine({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.mcpStatus', { appSessionId }, { refreshOn: MOVES_MCP });
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null); // P5 O7 M8: a server's identity, with its name and scope
  const place = useSwitchPlace(appSessionId, cwd);
  return (
    <WidgetFrame
      appSessionId={appSessionId}
      title={WIDGET_TITLE.mcp}
      subtitle={MCP.subtitle}
      note={place === null ? undefined : { text: MCP.reach(place), tooltip: MCP.reachTip }}
      command="mcp"
      state={read.state}
      error={read.error}
      readAt={read.readAt}
      close={close}
    >
      {read.data && <McpBody view={present(read.data)} actions={{ appSessionId, ready, answer: read.data, refresh: read.refresh, cwd, readAt: read.readAt, reachSaid: place !== null }} />}
    </WidgetFrame>
  );
}
