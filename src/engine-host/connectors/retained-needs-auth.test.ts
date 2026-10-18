// P3-HD: the needs-auth bootstrap on the engine's own retained reports (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// Decision Log 23). No engine may again be configured with a resource that advertises authorization, so the live case
// is retired and its assertion runs here on the real mcp_status answers the probe recorded in runs 39007800364 and
// 39011899461 (e2e/fixtures/connectors-direct/<run>/sources/engine-wire.jsonl, each checked against the hash its
// manifest retained): while the protected server is pending it attests nothing; once the engine reports it needs-auth,
// with no tools, its source is attested for the owner's first Connect, its tool metadata unknown, never fabricated.
// The user file is the one entry the probe wrote for it at those pins (`userauth: {type: 'http', url}`); the report is
// the engine's, unedited.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpStatusResponse } from '@shared/wire/control';
import { ConnectorStatusCache, connectorLaunchContext } from './provenance';

const FIXTURES = resolve(__dirname, '../../../e2e/fixtures/connectors-direct');
const RUNS = ['run-39007800364', 'run-39011899461'] as const;

type Row = { seq: number; direction: string; frame: { type?: string; response?: { response?: unknown } } };
type Reported = { name: string; status: string; scope?: string; config?: { type?: string; url?: string }; tools?: unknown };

// The run's sources wire, as retained, and its mcp_status answers in order.
function reportsOf(run: string): McpStatusResponse[] {
  const bytes = readFileSync(join(FIXTURES, run, 'sources/engine-wire.jsonl'));
  const manifest = JSON.parse(readFileSync(join(FIXTURES, run, 'manifest.json'), 'utf8')) as { files: { file: string; retainedSha256: string }[] };
  expect(createHash('sha256').update(bytes).digest('hex'), `${run}'s retained wire`).toBe(manifest.files.find((entry) => entry.file === 'sources/engine-wire.jsonl')!.retainedSha256);
  return bytes
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row)
    .filter((row) => row.direction === 'in' && row.frame.type === 'control_response')
    .map((row) => row.frame.response?.response as McpStatusResponse | undefined)
    .filter((answer): answer is McpStatusResponse => Array.isArray(answer?.mcpServers));
}
const userauth = (answer: McpStatusResponse) => (answer.mcpServers as Reported[]).find((server) => server.name === 'userauth')!;

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-hd-needsauth-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the needs-auth bootstrap on the engine’s retained reports', () => {
  for (const run of RUNS) {
    it(`${run}: pending attests nothing; the engine’s needs-auth report, without tools, attests the source`, async () => {
      const reports = reportsOf(run);
      const final = reports.at(-1)!;
      // what the engine actually answered
      expect(userauth(final)).toMatchObject({ status: 'needs-auth', scope: 'user', config: { type: 'http' } });
      expect(userauth(final).tools, 'no tools while it needs authorization').toBeUndefined();
      const pending = reports.filter((answer) => userauth(answer).status === 'pending');
      expect(pending.length, 'pending before it').toBeGreaterThan(0);
      const url = userauth(final).config!.url!;

      const config = join(dir, 'config');
      const project = join(dir, 'project');
      mkdirSync(config);
      mkdirSync(project);
      writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, mcpServers: { userauth: { type: 'http', url } } }));
      const context = connectorLaunchContext({ appSessionId: 'probe-1', launchId: 'PROBE-1', cwd: project, environment: { HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: config, PATH: '/usr/bin:/bin' }, localKey: { kind: 'directory', key: project } });
      const cache = new ConnectorStatusCache();
      cache.observe(cache.begin(context), pending.at(-1)!);
      expect(await cache.resolveSource(project, 'userauth')).toEqual({ ok: false, why: 'unobserved' });
      cache.observe(cache.begin(context), final);
      expect(await cache.resolve(project, 'userauth', 'rows')).toMatchObject({ ok: true, source: { server: 'userauth', scope: 'user', transport: 'http', url, entryPath: ['mcpServers', 'userauth'] }, tool: { readOnly: null } });
      const read = await cache.resolveSource(project, 'userauth');
      if (!read.ok) throw new Error(read.why);
      expect(await cache.readEntry(read.source)).toMatchObject({ ok: true, entry: { transport: 'http', url, headers: {} } });
    });
  }
});
