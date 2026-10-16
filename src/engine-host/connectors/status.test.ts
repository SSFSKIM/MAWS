// P3-H H3b: route E reads one server's tool from a live session's mcp_status answer, verified against the engine's own
// answers (spikes/p3-connectors/fixtures/engine-mcp-call.jsonl, 2.1.296; e2e/fixtures/connectors/run-38892612152,
// 2.1.301): connected, listed, not an SDK server, never ambiguous under the engine's name normalisation, its
// `readOnly` annotation as the engine reports it, and a fingerprint that a header value never enters.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpStatusResponse } from '@shared/wire/control';
import { connectorToolState } from './status';

const REPO_ROOT = resolve(__dirname, '../../..');
type Row = { seq: number; frame: { response?: { response?: unknown } } };
const statusAt = (path: string, seq: number): McpStatusResponse => {
  const rows = readFileSync(join(REPO_ROOT, path), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
  return rows.find((row) => row.seq === seq)!.frame.response!.response as McpStatusResponse;
};
const SPIKE = statusAt('spikes/p3-connectors/fixtures/engine-mcp-call.jsonl', 5);
const COLLISION = statusAt('e2e/fixtures/connectors/run-38892612152/collision/engine-wire.jsonl', 7);
const COLLISION_PENDING = statusAt('e2e/fixtures/connectors/run-38892612152/collision/engine-wire.jsonl', 5);
const NAMES = statusAt('e2e/fixtures/connectors/run-38892612152/names/engine-wire.jsonl', 7);

type Server = McpStatusResponse['mcpServers'][number] & { config?: Record<string, unknown>; tools?: { name: string; annotations?: Record<string, unknown> }[] };
const servers = (answer: McpStatusResponse) => answer.mcpServers as Server[];
const edited = (answer: McpStatusResponse, name: string, edit: (server: Server) => Server): McpStatusResponse => ({ ...answer, mcpServers: servers(answer).map((server) => (server.name === name ? edit(structuredClone(server)) : server)) });
const fingerprintOf = (answer: McpStatusResponse, server: string, tool: string) => {
  const state = connectorToolState(answer, server, tool);
  if (!state.ready) throw new Error(`not ready: ${state.why}`);
  return state.fingerprint;
};

describe('connectorToolState (route E, a live session’s mcp_status)', () => {
  it('reads a connected server’s listed tool with the engine’s `readOnly` annotation (not the SDK’s readOnlyHint)', () => {
    expect(connectorToolState(SPIKE, 'usertoy', 'metrics_snapshot')).toMatchObject({ ready: true, readOnly: true });
    expect(connectorToolState(SPIKE, 'usertoy', 'send_document')).toMatchObject({ ready: true, readOnly: false });
    const hinted = edited(SPIKE, 'usertoy', (server) => ({ ...server, tools: [{ name: 'metrics_snapshot', annotations: { readOnlyHint: true } }] }));
    expect(connectorToolState(hinted, 'usertoy', 'metrics_snapshot')).toMatchObject({ ready: true, readOnly: false });
    expect(connectorToolState(NAMES, 'claude.ai  Fixture (Drive)', 'rows.snapshot')).toMatchObject({ ready: true, readOnly: true });
  });

  it('answers why not: absent, not connected, a listed tool missing, an SDK server', () => {
    expect(connectorToolState(SPIKE, 'nope', 'metrics_snapshot')).toEqual({ ready: false, why: 'absent' });
    expect(connectorToolState(SPIKE, 'usertoy', 'nope')).toEqual({ ready: false, why: 'toolMissing' });
    const pending = edited(SPIKE, 'usertoy', (server) => ({ ...server, status: 'pending', tools: undefined })); // seq 5's shape before the connect
    expect(connectorToolState(pending, 'usertoy', 'metrics_snapshot')).toEqual({ ready: false, why: 'notConnected' });
    const failed = edited(SPIKE, 'usertoy', (server) => ({ ...server, status: 'needs-auth' }));
    expect(connectorToolState(failed, 'usertoy', 'metrics_snapshot')).toEqual({ ready: false, why: 'notConnected' });
    const sdk = edited(SPIKE, 'usertoy', (server) => ({ ...server, config: { type: 'sdk', name: 'usertoy' } }));
    expect(connectorToolState(sdk, 'usertoy', 'metrics_snapshot')).toEqual({ ready: false, why: 'sdk' });
  });

  it('refuses servers whose names normalise alike, whichever raw spelling is asked (the 2.1.301 capture: both reach the first)', () => {
    for (const name of ['collide.pair', 'collide_pair', 'swap_pair', 'swap.pair']) expect(connectorToolState(COLLISION, name, 'which')).toEqual({ ready: false, why: 'collision' });
    // before the servers connect (seq 5) the names are already ambiguous
    expect(connectorToolState(COLLISION_PENDING, 'swap_pair', 'which')).toEqual({ ready: false, why: 'collision' });
    // a collision with a server that is not even connected still makes the name ambiguous
    const pendingTwin = edited(COLLISION, 'collide_pair', (server) => ({ ...server, status: 'pending', tools: undefined }));
    expect(connectorToolState(pendingTwin, 'collide.pair', 'which')).toEqual({ ready: false, why: 'collision' });
    // claude.ai connectors also collapse and trim
    const twin: Server = { ...structuredClone(servers(NAMES)[0]!), name: 'claude.ai Fixture Drive' };
    expect(connectorToolState({ ...NAMES, mcpServers: [...servers(NAMES), twin] }, 'claude.ai  Fixture (Drive)', 'rows-v2')).toEqual({ ready: false, why: 'collision' });
    // names that stay apart are not refused
    expect(connectorToolState(NAMES, 'fixture.dots', 'rows.snapshot')).toMatchObject({ ready: true });
    expect(connectorToolState(NAMES, 'plain', 'rows_snapshot')).toMatchObject({ ready: true });
  });

  it('refuses tools of one server whose names normalise alike, and qualified names two servers share', () => {
    const twins = edited(SPIKE, 'usertoy', (server) => ({ ...server, tools: [{ name: 'rows.snapshot', annotations: { readOnly: true } }, { name: 'rows_snapshot', annotations: { readOnly: true } }, { name: 'other' }] }));
    expect(connectorToolState(twins, 'usertoy', 'rows.snapshot')).toEqual({ ready: false, why: 'collision' });
    expect(connectorToolState(twins, 'usertoy', 'rows_snapshot')).toEqual({ ready: false, why: 'collision' });
    expect(connectorToolState(twins, 'usertoy', 'other')).toMatchObject({ ready: true });
    // mcp__a__b__c is both server `a__b`'s tool `c` and server `a`'s tool `b__c`
    const split: McpStatusResponse = {
      mcpServers: [
        { name: 'a__b', status: 'connected', config: { type: 'stdio', command: 'x' }, scope: 'user', tools: [{ name: 'c' }] },
        { name: 'a', status: 'connected', config: { type: 'stdio', command: 'y' }, scope: 'user', tools: [{ name: 'b__c' }] },
      ],
    } as McpStatusResponse;
    expect(connectorToolState(split, 'a__b', 'c')).toEqual({ ready: false, why: 'collision' });
    expect(connectorToolState(split, 'a', 'b__c')).toEqual({ ready: false, why: 'collision' });
  });

  it('fingerprints the server’s scope, transport and command and args or URL with the tool, never a header value', () => {
    const http = fingerprintOf(SPIKE, 'userhttp', 'metrics_snapshot');
    expect(http).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintOf(SPIKE, 'userhttp', 'metrics_snapshot')).toBe(http); // stable
    const headers = edited(SPIKE, 'userhttp', (server) => ({ ...server, config: { ...server.config, headers: { 'X-Probe-Header': 'sentinel-rotated', Authorization: 'Bearer other' } } }));
    expect(fingerprintOf(headers, 'userhttp', 'metrics_snapshot')).toBe(http);
    const moved = edited(SPIKE, 'userhttp', (server) => ({ ...server, config: { ...server.config, url: 'http://127.0.0.1:1/mcp' } }));
    expect(fingerprintOf(moved, 'userhttp', 'metrics_snapshot')).not.toBe(http);
    const stdio = fingerprintOf(SPIKE, 'usertoy', 'metrics_snapshot');
    const args = edited(SPIKE, 'usertoy', (server) => ({ ...server, config: { ...server.config, args: ['other.mjs'] } }));
    expect(fingerprintOf(args, 'usertoy', 'metrics_snapshot')).not.toBe(stdio);
    const env = edited(SPIKE, 'usertoy', (server) => ({ ...server, config: { ...server.config, env: { TOKEN: 'sentinel' } } }));
    expect(fingerprintOf(env, 'usertoy', 'metrics_snapshot')).toBe(stdio);
    // another scope, another server name or another tool is another identity
    expect(fingerprintOf(SPIKE, 'projtoy', 'metrics_snapshot')).not.toBe(stdio); // same command, project scope
    expect(fingerprintOf(SPIKE, 'usertoy', 'send_document')).not.toBe(stdio);
  });
});
