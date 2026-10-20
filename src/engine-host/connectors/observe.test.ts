// P4-B5: route E's observation alone (`ConnectorCalls.observe`, the host's `connectors.observe`): the owner's delivery
// sheet has one live session's mcp_status read so route D's cache knows what that engine reports. A scripted engine
// answers mcp_status; nothing else is written (no probe, no tool), the report lands only for the session's live launch
// in its launch directory, and main's going discards an answer still on its way.
import { describe, expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import { ControlClient } from '../rpc';
import type { EngineTransport } from '../transport';
import { ConnectorCalls } from './calls';
import { ConnectorStatusCache, connectorLaunchContext } from './provenance';

const SERVERS = [{ name: 'notion', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy' }, tools: [{ name: 'notion-create-pages' }] }];

function scene(options: { hold?: boolean } = {}) {
  const writes: StdinFrame[] = [];
  const held: (() => void)[] = [];
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame) => {
      writes.push(frame);
      if (frame.type === 'control_request' && (frame.request as { subtype: string }).subtype === 'mcp_status') {
        const answer = () => client.observe({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: { mcpServers: SERVERS } } } as never);
        if (options.hold) held.push(answer);
        else queueMicrotask(answer);
      }
      return Promise.resolve();
    },
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const client = new ControlClient(transport, { row: (direction, frame) => ({ seq: 0, direction, at: '', frame }) }, 'L1', { warn: () => {} });
  const context = connectorLaunchContext({ appSessionId: 'app-1', launchId: 'L1', cwd: '/work/project', environment: { HOME: '/h', PATH: '/bin' }, localKey: { kind: 'directory', key: '/work/project' } });
  let status = { launchId: 'L1', cwd: '/work/project' };
  const session = { lifecycle: 'ready', control: client, status: () => status, connectorLaunchContext: () => context };
  const statusCache = new ConnectorStatusCache();
  const calls = new ConnectorCalls({ session: (id) => (id === 'app-1' ? session : undefined), store: () => null, completed: () => {}, statusCache });
  return { calls, statusCache, writes, held, move: (cwd: string) => (status = { ...status, cwd }) };
}
const subtypes = (writes: StdinFrame[]) => writes.map((frame) => (frame.type === 'control_request' ? (frame.request as { subtype: string }).subtype : frame.type));

describe('ConnectorCalls.observe', () => {
  it('reads the live session’s mcp_status alone and hands the whole report to the cache', async () => {
    const { calls, statusCache, writes } = scene();
    expect(await calls.observe({ appSessionId: 'app-1', launchId: 'L1', cwd: '/work/project' })).toEqual({ observed: true });
    expect(subtypes(writes)).toEqual(['mcp_status']);
    expect(statusCache.candidates('notion-create-pages')).toEqual([{ cwd: '/work/project', server: 'notion', listed: true, http: false }]);
  });

  it('observes nothing for a session not live in that launch and directory', async () => {
    const { calls, statusCache, writes } = scene();
    expect(await calls.observe({ appSessionId: 'app-2', launchId: 'L1', cwd: '/work/project' })).toEqual({ observed: false });
    expect(await calls.observe({ appSessionId: 'app-1', launchId: 'L0', cwd: '/work/project' })).toEqual({ observed: false });
    expect(await calls.observe({ appSessionId: 'app-1', launchId: 'L1', cwd: '/elsewhere' })).toEqual({ observed: false });
    expect(writes).toEqual([]);
    expect(statusCache.candidates('notion-create-pages')).toEqual([]);
  });

  it('discards an answer arriving after the session moved directory, or after main went', async () => {
    const moved = scene({ hold: true });
    const asked = moved.calls.observe({ appSessionId: 'app-1', launchId: 'L1', cwd: '/work/project' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    moved.move('/work/other');
    moved.held.splice(0).forEach((answer) => answer());
    expect(await asked).toEqual({ observed: false });
    expect(moved.statusCache.candidates('notion-create-pages')).toEqual([]);

    const gone = scene({ hold: true });
    const pending = gone.calls.observe({ appSessionId: 'app-1', launchId: 'L1', cwd: '/work/project' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    gone.calls.close();
    gone.held.splice(0).forEach((answer) => answer());
    expect(await pending).toEqual({ observed: false });
    expect(gone.statusCache.candidates('notion-create-pages')).toEqual([]);
  });
});
