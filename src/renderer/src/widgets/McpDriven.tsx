// `/mcp` for a terminal session driven through its bridge (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md,
// "The slash palette"): the bridge's `read mcp`, which sees only the servers connected with tools (it says it is not
// exact, and so does the widget), each with Reconnect; and a server named to enable, since a disabled one is not in the
// read. Both run as `command mcp <verb> <name>` through the session's port, gated by its capabilities, and their
// outcome is the command op's end, worded as the slash palette words it; the list is read again after each.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpBody } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import { commandOutcomeText } from '../lane-a/conversation/words';
import { followOp } from '../lane-a/outcomes';
import { readLaneA } from '../lane-a/watches';
import { ipc } from '../ipc/client';
import type { SessionControls } from '../session/controls/types';
import { FIELD } from '../sessions/ui';
import { MCP, MCP_ACTIONS, WIDGET_TITLE } from './copy';
import { Row, Rows, TextButton } from './parts';
import type { ReadState } from './read';
import { WidgetFrame } from './WidgetFrame';

export const MCP_DRIVEN = {
  inexact: 'Only servers connected with tools are listed; the terminal’s /mcp shows every server',
  enableLabel: 'Server to enable',
  enable: 'Enable',
  working: 'Working…',
};

interface Server {
  name: string;
  status: string;
  tools: number;
}

const serversOf = (result: unknown): Server[] => {
  const servers = (result as { servers?: unknown } | null)?.servers;
  return Array.isArray(servers)
    ? servers.flatMap((s: { name?: unknown; status?: unknown; tools?: unknown }) => (typeof s?.name === 'string' ? [{ name: s.name, status: typeof s.status === 'string' ? s.status : 'unknown', tools: typeof s.tools === 'number' ? s.tools : 0 }] : []))
    : [];
};

export function McpDriven({ appSessionId, controls, close }: { appSessionId: AppSessionId; controls: SessionControls; close(): void }) {
  const [read, setRead] = useState<{ state: ReadState; servers: Server[]; error: string | null }>({ state: 'loading', servers: [], error: null });
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const refresh = useCallback(async () => {
    const answer = await readLaneA(appSessionId, 'mcp');
    if (!mounted.current) return;
    setRead((held) => (answer.ok ? { state: 'ready', servers: serversOf(answer.result), error: null } : { state: held.state === 'ready' ? 'ready' : 'error', servers: held.servers, error: answer.message }));
  }, [appSessionId]);
  useEffect(() => void refresh(), [refresh]);

  const run = async (verb: 'enable' | 'reconnect', server: string) => {
    setBusy(true);
    setLine(MCP_DRIVEN.working);
    const result = await controls.command('mcp', `${verb} ${server}`);
    if (result.state !== 'done') {
      setBusy(false);
      setLine(result.state === 'refused' ? result.message : MCP_ACTIONS.unconfirmed(result.why));
      return;
    }
    const id = (result.result as { id?: unknown } | null)?.id;
    const ended = (body: OpBody | null) => {
      if (!mounted.current) return;
      setBusy(false);
      setLine(body ? commandOutcomeText(body).text : MCP_ACTIONS.unconfirmed(MCP_ACTIONS.done));
      void refresh();
    };
    if (typeof id === 'string') followOp(appSessionId, id, ended, ipc);
    else ended(null);
  };

  const enable = controls.capability('mcp.enable');
  const reconnect = controls.capability('mcp.reconnect');
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.mcp} command="mcp" state={read.state} error={read.error} close={close}>
      <div className="flex flex-col gap-2">
        {read.servers.length === 0 ? (
          <p className="m-0 text-ui-sm text-fg-muted">{MCP.none}</p>
        ) : (
          <Rows label={MCP.list}>
            {read.servers.map((server) => (
              <Row
                key={server.name}
                data-mcp-server={server.name}
                main={<span className="font-semibold">{server.name}</span>}
                note={`${server.status}${server.tools > 0 ? ` · ${MCP.tools(server.tools)}` : ''}`}
                actions={
                  <TextButton onClick={() => void run('reconnect', server.name)} disabled={busy || !reconnect.available} title={reconnect.available ? undefined : reconnect.reason}>
                    {MCP_ACTIONS.reconnect}
                  </TextButton>
                }
              />
            ))}
          </Rows>
        )}
        <p className="m-0 text-ui-sm text-fg-faint">{MCP_DRIVEN.inexact}</p>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== '') void run('enable', name.trim());
          }}
        >
          <input aria-label={MCP_DRIVEN.enableLabel} placeholder={MCP_DRIVEN.enableLabel} className={FIELD} value={name} disabled={!enable.available} title={enable.available ? undefined : enable.reason} onChange={(event) => setName(event.target.value)} />
          <TextButton onClick={() => name.trim() !== '' && void run('enable', name.trim())} disabled={busy || !enable.available || name.trim() === ''} title={enable.available ? undefined : enable.reason}>
            {MCP_DRIVEN.enable}
          </TextButton>
        </form>
        {line !== null && (
          <span role="status" className="text-ui-sm text-fg-muted">
            {line}
          </span>
        )}
      </div>
    </WidgetFrame>
  );
}
