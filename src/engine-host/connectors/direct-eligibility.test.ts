// P3-HD M3b: route D's grant-backed eligibility and host-only tool hints in the operation table (./direct-calls.ts;
// docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, Decision Log 15, 18 and 21), over the real artifact store and
// observation cache with the scripted pool (./direct-pool.fixture.ts) where MAWS's own connection is.
//
// - A resolution ranks main's directories: the first observed candidate the artifact's existing grant matches, else the
//   first candidate with no tool metadata that grant matches (grant-backed: no readOnly is invented), else the first
//   observed candidate. Grant checks consume nothing; a failing store yields no grant-backed candidate.
// - Hints, published by owner discovery and by a call's successful live listing, turn a metadata-absent candidate into
//   an observed one; their lifetime follows the credential and main's attachment.
// - At the call, the live tools/list decides: a read grant whose live tool may write is the private `changed`, leaving
//   the grant for the owner.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectOperationOutcome, DirectResolveAnswer } from '@shared/ipc/schema/connectors';
import type { McpStatusResponse } from '@shared/wire/control';
import { openDocuments, type Documents } from '../documents';
import type { DirectLease, DirectTool } from './direct-client';
import { ScriptedPool, deferred, type Deferred } from './direct-pool.fixture';
import { DirectCalls, type DirectCallsOptions, type DirectStartInput } from './direct-calls';
import { ConnectorStatusCache, connectorLaunchContext } from './provenance';

type Server = { name: string; status: string; scope: string; source: string; config: Record<string, unknown>; tools?: { name: string; annotations?: Record<string, unknown> }[] };
const LISTED = [{ name: 'rows', annotations: { readOnly: true } }, { name: 'send', annotations: {} }];
const toy = (args: string[], tools: Server['tools'] = LISTED): Server => ({ name: 'usertoy', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'toy', args }, tools });
const report = (...servers: Server[]): McpStatusResponse => ({ mcpServers: servers });
const C1 = '00000000-0000-4000-8000-0000000000c1';

let dir: string;
let documents: Documents;
let cache: ConnectorStatusCache;
let pool: ScriptedPool;
let completed: string[];
let calls: DirectCalls;
let artifactId: string;
let ids = 0;
let launches = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

// a directory observed by an engine launched there with `configDir` (each its own user file)
function directory(name: string, configDir: string, server: Server): string {
  const cwd = join(dir, name);
  mkdirSync(cwd, { recursive: true });
  launches += 1;
  const context = connectorLaunchContext({ appSessionId: `app-${launches}`, launchId: `L${launches}`, cwd, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: configDir, PATH: join(dir, 'bin'), USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', TERM: 'dumb' }, localKey: { kind: 'directory', key: cwd } });
  cache.observe(cache.begin(context), report(server));
  return cwd;
}
function configHome(name: string, args: string[]): string {
  const home = join(dir, name);
  mkdirSync(home);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { usertoy: { type: 'stdio', command: 'toy', args } } }));
  return home;
}

function build(options: Partial<DirectCallsOptions> = {}): DirectCalls {
  completed = [];
  return new DirectCalls({ cache, pool: pool as never, store: () => documents.store, completed: (id) => void completed.push(id), ...options });
}

let mainHome: string; // args ['toy-server.mjs']
let otherHome: string; // args ['other.mjs']: another fingerprint for the same server name

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-hd-eligibility-'));
  for (const path of [join(dir, 'home'), join(dir, 'bin'), join(dir, 'data')]) mkdirSync(path);
  writeFileSync(join(dir, 'bin', 'toy'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'bin', 'toy'), 0o755);
  mainHome = configHome('config-main', ['toy-server.mjs']);
  otherHome = configHome('config-other', ['other.mjs']);
  documents = openDocuments(join(dir, 'data'), () => {})!;
  cache = new ConnectorStatusCache();
  pool = new ScriptedPool();
  calls = build();
  artifactId = (await documents.store.create({ kind: 'html', title: 'Live page', content: { bytes: new TextEncoder().encode('<p>a</p>') } }, { kind: 'human' })).id;
});
afterEach(() => {
  void calls.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function taken(operationId: string): Promise<DirectOperationOutcome> {
  await vi.waitFor(() => expect(completed).toContain(operationId), { interval: 1 });
  return calls.take(operationId)!;
}
async function resolveIn(directories: string[], tool: string | null = 'rows'): Promise<DirectResolveAnswer> {
  const operationId = nextId();
  calls.resolve({ operationId, artifactId, directories, server: 'usertoy', ...(tool === null ? {} : { tool }) });
  const outcome = await taken(operationId);
  if (outcome.kind !== 'resolve') throw new Error(outcome.kind);
  return outcome.answer;
}
// the identified entry's fingerprint for `tool` in `cwd`, whatever its reports listed
async function fingerprintIn(cwd: string, tool = 'rows'): Promise<string> {
  const answer = await cache.resolve(cwd, 'usertoy', tool);
  if (!answer.ok) throw new Error(answer.why);
  return answer.tool.fingerprint;
}
const grant = async (cwd: string, mode: 'read' | 'once' = 'read', tool = 'rows') => documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool, fingerprint: await fingerprintIn(cwd, tool), mode });
const sourceOf = (answer: DirectResolveAnswer) => {
  if (!answer.ready) throw new Error(answer.why);
  return answer.source;
};
async function discover(cwd: string, credential?: DirectStartInput['credential']) {
  const source = sourceOf(await resolveIn([cwd], null));
  const operationId = nextId();
  calls.discover({ operationId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy', ...(credential && { credential }) });
  return operationId;
}
async function startIn(cwd: string, mode: 'read' | 'once', tool = 'rows', credential?: DirectStartInput['credential']) {
  const answer = await resolveIn([cwd], tool);
  const source = sourceOf(answer);
  const input: DirectStartInput = { operationId: nextId(), artifactId, directory: source.directory, sourceId: source.sourceId, generation: source.generation, server: 'usertoy', tool, arguments: {}, fingerprint: await fingerprintIn(cwd, tool), mode, ...(credential && { credential }) };
  calls.start(input);
  const outcome = await taken(input.operationId);
  if (outcome.kind !== 'call') throw new Error(outcome.kind);
  return outcome.outcome;
}
const toolCalls = () => pool.wire.filter((entry) => entry.kind === 'tools/call');

describe('directResolve ranks main’s directories by the artifact’s existing grant', () => {
  it('an observed candidate the grant matches wins over an earlier observed one it does not; without a grant the first observed answers', async () => {
    const first = directory('first', mainHome, toy(['toy-server.mjs']));
    const second = directory('second', otherHome, toy(['other.mjs']));
    expect(await resolveIn([first, second])).toMatchObject({ ready: true, source: { directory: first }, tool: { readOnly: true } });
    await grant(second);
    expect(await resolveIn([first, second])).toEqual({ ready: true, source: expect.objectContaining({ directory: second }), tool: { fingerprint: await fingerprintIn(second), readOnly: true } });
  });

  it('a metadata-absent candidate the grant matches is grant-backed, with no readOnly invented, ahead of an unmatched observed one', async () => {
    const observed = directory('observed', mainHome, toy(['toy-server.mjs']));
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await grant(unknown);
    const answer = await resolveIn([observed, unknown]);
    expect(answer).toEqual({ ready: true, source: expect.objectContaining({ directory: unknown }), tool: { fingerprint: await fingerprintIn(unknown), grantBacked: true } });
    expect(JSON.stringify(answer)).not.toContain('readOnly');
  });

  it('an observed candidate with the same grant-matched fingerprint is not hidden by an earlier metadata-absent one', async () => {
    const unknown = directory('unknown', mainHome, toy(['toy-server.mjs'], []));
    const observed = directory('observed', mainHome, toy(['toy-server.mjs']));
    await grant(observed);
    expect(await fingerprintIn(unknown)).toBe(await fingerprintIn(observed));
    expect(await resolveIn([unknown, observed])).toMatchObject({ ready: true, source: { directory: observed }, tool: { readOnly: true } });
  });

  it('metadata-absent candidates no grant matches are not served: no new grant from unknown metadata', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'toolMissing' });
    const elsewhere = directory('elsewhere', mainHome, toy(['toy-server.mjs'], []));
    await grant(elsewhere); // a grant under another fingerprint
    expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'toolMissing' });
    expect(await resolveIn([unknown, elsewhere])).toMatchObject({ ready: true, source: { directory: elsewhere }, tool: { grantBacked: true } });
  });

  // M3b review fix: a grant check that could not be made (no store, or one that throws) is no answer about the grant,
  // so no candidate stands on it, observed ones included: the resolution is unavailable rather than a ranking guess.
  const unanswered: [string, () => unknown][] = [
    ['an absent store', () => null],
    ['a store whose check throws', () => ({ ...documents.store, checkConnectorCall: () => Promise.reject(new Error('the store broke')) })],
  ];
  for (const [label, store] of unanswered) {
    it(`${label} yields no candidate at all: the resolution is unavailable`, async () => {
      const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
      const observed = directory('observed', mainHome, toy(['toy-server.mjs']));
      await grant(unknown);
      calls = build({ store: store as never });
      expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'unavailable' });
      expect(await resolveIn([unknown, observed])).toEqual({ ready: false, why: 'unavailable' });
      expect(await resolveIn([observed])).toEqual({ ready: false, why: 'unavailable' });
      expect(await resolveIn([observed], null)).toMatchObject({ ready: true, source: { directory: observed } }); // the source alone checks no grant
    });
  }

  it('a successful check that matches no grant still answers the first observed candidate (a new grant’s metadata)', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    const observed = directory('observed', mainHome, toy(['toy-server.mjs']));
    const other = directory('other', otherHome, toy(['other.mjs']));
    expect(await resolveIn([unknown, observed, other])).toMatchObject({ ready: true, source: { directory: observed }, tool: { readOnly: true } });
    await documents.store.grantConnectorTool(artifactId, { server: 'usertoy', tool: 'rows', fingerprint: 'a'.repeat(64), mode: 'read' }); // matches none
    expect(await resolveIn([unknown, observed, other])).toMatchObject({ ready: true, source: { directory: observed }, tool: { readOnly: true } });
  });

  it('ranking consumes nothing: an Allow once matched by a resolution is still there, and no connection was made', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await grant(unknown, 'once', 'send');
    expect(await resolveIn([unknown], 'send')).toMatchObject({ ready: true, tool: { grantBacked: true } });
    expect(await documents.store.connectorGrants(artifactId)).toMatchObject([{ tool: 'send', mode: 'once' }]);
    expect(pool.acquires).toHaveLength(0);
  });
});

describe('a grant-backed call proves the live tool before anything is consumed or written', () => {
  it('runs an existing read grant on a metadata-absent source when the live tools/list says read-only', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await grant(unknown);
    expect(await startIn(unknown, 'read')).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'rows 107' }] } });
    expect(toolCalls()).toEqual([{ kind: 'tools/call', name: 'rows' }]);
  });

  it('a read grant whose live tool may write is the private changed: nothing written, the grant left for the owner', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await grant(unknown);
    pool.tools = [{ name: 'rows', readOnly: false }];
    expect(await startIn(unknown, 'read')).toEqual({ ok: false, failure: 'unavailable', reason: 'changed' });
    expect(toolCalls()).toEqual([]);
    expect(await documents.store.connectorGrants(artifactId)).toMatchObject([{ tool: 'rows', mode: 'read' }]);
  });

  it('an Allow once on a metadata-absent source runs a tool that may write, and is consumed once', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await grant(unknown, 'once', 'send');
    expect(await startIn(unknown, 'once', 'send')).toMatchObject({ ok: true });
    expect(await documents.store.connectorGrants(artifactId)).toEqual([]);
    expect(toolCalls()).toEqual([{ kind: 'tools/call', name: 'send' }]);
  });
});

describe('host-only tool hints', () => {
  it('the owner’s discovery makes a metadata-absent source’s tools observed for resolution, without any grant', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'toolMissing' });
    expect((await taken(await discover(unknown))).kind).toBe('discover');
    expect(await resolveIn([unknown])).toMatchObject({ ready: true, source: { directory: unknown }, tool: { readOnly: true } });
    expect(await resolveIn([unknown], 'send')).toMatchObject({ ready: true, tool: { readOnly: false } });
    expect(toolCalls()).toEqual([]);
  });

  it('a successful live listing of a call repopulates the hint, so the next resolution is observed rather than grant-backed', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await grant(unknown);
    expect(await resolveIn([unknown])).toMatchObject({ tool: { grantBacked: true } });
    await startIn(unknown, 'read');
    expect(await resolveIn([unknown])).toMatchObject({ ready: true, tool: { readOnly: true } });
  });

  it('engine and live metadata combine conservatively: either saying the tool may write makes it not read-only', async () => {
    const observed = directory('observed', mainHome, toy(['toy-server.mjs']));
    pool.tools = [{ name: 'rows', readOnly: false }];
    await taken(await discover(observed));
    expect(await resolveIn([observed])).toMatchObject({ ready: true, tool: { readOnly: false } });
  });

  it('a credential’s withdrawal (a rotation) forgets its hints; the same demand under the next epoch repopulates them', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await taken(await discover(unknown, { connectionId: C1, credentialEpoch: 1, accessToken: 'token-1' }));
    expect(await resolveIn([unknown])).toMatchObject({ ready: true, tool: { readOnly: true } });
    calls.withdraw(C1, 1);
    expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'toolMissing' });
    await taken(await discover(unknown, { connectionId: C1, credentialEpoch: 2, accessToken: 'token-2' }));
    expect(await resolveIn([unknown])).toMatchObject({ ready: true, tool: { readOnly: true } });
  });

  it('main’s going forgets every hint', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    await taken(await discover(unknown));
    expect(await resolveIn([unknown])).toMatchObject({ ready: true, tool: { readOnly: true } });
    await calls.close(); // the observations' own clear is the host's, beside it (./register.ts); the source stands here
    expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'toolMissing' });
  });

  // Each acquired lease's tools/list waits for its own gate, answering the tools given then.
  function heldListings(): { gates: Deferred[]; answers: DirectTool[][] } {
    const held = { gates: [] as Deferred[], answers: [] as DirectTool[][] };
    const acquire = pool.acquire.bind(pool);
    pool.acquire = async (spec, signal) => {
      const acquired = await acquire(spec, signal);
      if (!acquired.ok) return acquired;
      const index = held.gates.length;
      const gate = deferred();
      held.gates.push(gate);
      const lease: DirectLease = {
        ...acquired.lease,
        listTools: async () => {
          await gate.promise;
          return { ok: true, tools: held.answers[index] ?? [] };
        },
      };
      return { ok: true, lease };
    };
    return held;
  }

  it('a delayed listing admitted earlier does not replace a newer one', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    const held = heldListings();
    held.answers = [[{ name: 'rows', readOnly: false }], [{ name: 'rows', readOnly: true }]];
    const older = await discover(unknown);
    await vi.waitFor(() => expect(held.gates).toHaveLength(1), { interval: 1 });
    const newer = await discover(unknown);
    await vi.waitFor(() => expect(held.gates).toHaveLength(2), { interval: 1 });
    held.gates[1]!.resolve();
    await taken(newer);
    held.gates[0]!.resolve();
    await taken(older);
    expect(await resolveIn([unknown])).toMatchObject({ ready: true, tool: { readOnly: true } });
  });

  it('a listing pending across a withdrawal of its credential publishes nothing', async () => {
    const unknown = directory('unknown', otherHome, toy(['other.mjs'], []));
    const held = heldListings();
    held.answers = [[{ name: 'rows', readOnly: true }]];
    await discover(unknown, { connectionId: C1, credentialEpoch: 1, accessToken: 'token-1' });
    await vi.waitFor(() => expect(held.gates).toHaveLength(1), { interval: 1 });
    calls.withdraw(C1, 1);
    held.gates[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await resolveIn([unknown])).toEqual({ ready: false, why: 'toolMissing' });
  });
});
