// The two-build cross-minor check (P5 OX1: O1's execution document, M6 and its residue 11; docs/tech-debt-tracker.md's
// row "No real two-build check exists"; O6's residue 38): this checkout's built app against another build's supervisor
// on one profile, and the other build's app against this one's. The other build is the peer the gate checked out and
// built beside this checkout (MAWS_E2E_PEER_ROOT: its root, with its own out/ and node_modules; gate.yml's PEER_E2E and
// the `Peer:` trailer scripts/ci-gate.sh writes, the merge base with master unless `--peer` names another). Without a
// peer the group runs nothing. Of the two builds the older is the one of the lower WIRE_MINOR (on a tie, the peer).
//   (update)    the older app starts a kept session and quits with keep; the newer app attaches to its supervisor;
//   (downgrade) the newer app keeps the session; the older one attaches.
// In each, the attaching app's hello crosses the minor (host.log names the app's wire, the app's main the supervisor's),
// the app is served as another build (`matches: 'build'`, the update banner, exit-when-idle armed), the kept session's
// tail reaches its main (the background failure journaled while no app ran raises the Needs-you item only main's live
// derivation raises; the request raised while away is pending, its answer is played on and its rows arrive live), a
// launch on the kept supervisor plays a turn, and once every session there is idle the kept supervisor exits by itself
// and the app moves to a supervisor of its own build, which serves a launch too.
// Across the gap, OX1's negotiation (src/shared/ipc/wire.ts): a peer that lacks a command answers `unknown_command`,
// and one that lacks an event or an object key drops it (the tolerant reader, logged once), refusing nothing else a
// peer of its major sends. So in the update a command the newer build added that the engine host serves answers
// `unknown_command` from the older supervisor and is served once the app has moved, and one another owner serves (main,
// for `machine`) answers alike whichever supervisor is attached; in both directions neither end logs a refusal of what
// the other sent. The older app cannot name a command it lacks: its preload bridges only its own registry.
// Run by `pnpm e2e:cross-build` (MAWS_CROSS_BUILD_E2E=1), which the gate adds to a run whose tree and peer differ in
// WIRE_MINOR (.github/scripts/gate-plan.mjs).
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import { classifyWireChange, type WireManifest } from '@shared/ipc/wire';
import { invoke, replaySpec, turnsJournal, value } from './support/c7-replay';
import { REPO_ROOT } from './support/launch';
import { isAlive } from './support/processes';
import { attentionOf, eventsOf, isRequestRow, isTaskFailureRow, pendingPermissions, PERMISSION, PROMPT, statusOf, suffix, tailFixture, TASK_FAILED, withScratch, type Scratch } from './support/supervisor-scratch';

const PEER = process.env.MAWS_E2E_PEER_ROOT || null;
test.skip(process.env.MAWS_CROSS_BUILD_E2E !== '1', 'the two-build check runs under pnpm e2e:cross-build (MAWS_CROSS_BUILD_E2E=1)');
test.skip(PEER === null, 'no peer build beside this checkout (MAWS_E2E_PEER_ROOT): the gate builds one for a run whose Peer: trailer names it');

const ROW_MS = '250'; // the kept turn: about 11 s from the prompt to the request, 10 s from the answer to the result
const IDLE_MS = 10_000; // the attaching app's idle time: its sessions on the kept supervisor are released this long after they idle

// ---- the two builds ---------------------------------------------------------------------------------------------------

interface Build {
  label: string;
  root: string | undefined; // launch.ts's `root`: undefined for this checkout
  manifest: WireManifest; // its src/shared/ipc/wire-manifest.json, which its wire.test.ts holds its code to
  mainOnly: Set<string>; // the commands its windows cannot send: its preload bridges only the others
}
const wireOf = (build: Build) => `${build.manifest.major}.${build.manifest.minor}`;
type CommandEntry = { owner: string; input: unknown };
const commandOf = (build: Build, name: string) => build.manifest.entries[`commands.${name}`] as CommandEntry | undefined;

function buildAt(root: string, label: string): Build {
  const path = join(root, 'src/shared/ipc/wire-manifest.json');
  if (!existsSync(path)) throw new Error(`${label} at ${root} has no ${path}: a build before protocol 3 has no minor to cross`);
  return { label, root: root === REPO_ROOT ? undefined : root, manifest: JSON.parse(readFileSync(path, 'utf8')) as WireManifest, mainOnly: mainOnlyOf(root) };
}

// Every `mainOnlyCommands` list of a build's src/shared/ipc/names/*.ts (its schema.ts pins them, with the bridged lists,
// to its registry's keys), read from its source with the comments dropped.
function mainOnlyOf(root: string): Set<string> {
  const dir = join(root, 'src/shared/ipc/names');
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [, list] of source.matchAll(/mainOnlyCommands\s*=\s*\[([^\]]*)\]/g)) for (const [, name] of list!.matchAll(/'([^']+)'/g)) names.add(name!);
  }
  if (!names.has('host.configure')) throw new Error(`${dir} names no main-only command the check can read (host.configure is one)`);
  return names;
}

function builds(): { older: Build; newer: Build } {
  const here = buildAt(REPO_ROOT, 'this build');
  const peer = buildAt(PEER!, 'the peer');
  expect(peer.manifest.major, `the peer speaks wire ${wireOf(peer)} and this build ${wireOf(here)}: the group checks two builds of one major`).toBe(here.manifest.major);
  const [older, newer] = here.manifest.minor < peer.manifest.minor ? [here, peer] : [peer, here];
  // OX1's rule between the two, as between two minors: within a major nothing may change but additively (a JSON Schema
  // rendering rebased after a zod upgrade reads as breaking here too; such a pair is not one this check can vouch for)
  expect(classifyWireChange(older.manifest, newer.manifest).breaking, `${older.label} (wire ${wireOf(older)}) to ${newer.label} (wire ${wireOf(newer)})`).toEqual([]);
  return { older, newer };
}

// ---- JSON Schema, as the manifest renders the wire (z.toJSONSchema) ---------------------------------------------------

type Schema = Record<string, unknown>;
const isSchema = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value);
function deref(schema: unknown, root: unknown): unknown {
  if (!isSchema(schema) || typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return schema;
  return deref(schema.$ref.slice(2).split('/').reduce<unknown>((at, key) => (isSchema(at) ? at[key] : undefined), root), root);
}

// A value `schema` accepts, for a command's input: the first of every choice, each required property, the least of
// every bound. A pattern or a format it does not know may defeat it; INPUTS then names that command's input.
function sampleOf(schema: unknown, root: unknown = schema): unknown {
  const s = deref(schema, root);
  if (!isSchema(s)) return undefined;
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  for (const choice of [s.anyOf, s.oneOf, s.allOf]) if (Array.isArray(choice)) return sampleOf(choice[0], root);
  const type = Array.isArray(s.type) ? (s.type.includes('null') ? 'null' : s.type[0]) : s.type;
  if (type === 'object') {
    const properties = isSchema(s.properties) ? s.properties : {};
    return Object.fromEntries((Array.isArray(s.required) ? (s.required as string[]) : []).map((key) => [key, sampleOf(properties[key], root)]));
  }
  if (type === 'array') return Array.from({ length: Number(s.minItems ?? 0) }, () => sampleOf(s.items, root));
  if (type === 'string') return s.format === 'uuid' ? randomUUID() : s.format === 'date-time' ? new Date().toISOString() : 'x'.repeat(Math.max(1, Number(s.minLength ?? 1)));
  if (type === 'integer' || type === 'number') return typeof s.minimum === 'number' ? s.minimum : typeof s.exclusiveMinimum === 'number' ? s.exclusiveMinimum + 1 : 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return undefined; // no constraint: z.void(), z.unknown()
}

// `value` less every object key `schema` has no property for, through plain nested objects: what that build's own window
// would send, so this checkout's launch defaults reach the other build's app as its renderer would build them.
function fitTo(schema: unknown, value: unknown, root: unknown = schema): unknown {
  const s = deref(schema, root);
  if (!isSchema(s) || !isSchema(s.properties) || !isSchema(value)) return value;
  const properties = s.properties;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key in properties).map(([key, v]) => [key, fitTo(properties[key], v, root)]));
}

// A command the sampler cannot give an input to, named here with one its schema accepts.
const INPUTS: Record<string, unknown> = {};

// ---- one crossing -----------------------------------------------------------------------------------------------------

type Answer = { ok: true } | { ok: false; code: string; message: string };
const answerOf = (result: { ok: boolean; error?: { code: string; message: string } }): Answer => (result.ok ? { ok: true } : { ok: false, code: result.error!.code, message: result.error!.message });

// Each command `newer` added that its windows can send, invoked from one of `newer`'s app with its sample input.
async function probe(page: Page, newer: Build, older: Build): Promise<Map<string, Answer>> {
  const answers = new Map<string, Answer>();
  for (const name of addedCommands(newer, older).filter((name) => !newer.mainOnly.has(name))) {
    const input = name in INPUTS ? INPUTS[name] : sampleOf(commandOf(newer, name)!.input);
    answers.set(name, answerOf(await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const)));
  }
  return answers;
}
const addedCommands = (newer: Build, older: Build) =>
  Object.keys(newer.manifest.entries).filter((key) => key.startsWith('commands.') && !(key in older.manifest.entries)).map((key) => key.slice('commands.'.length));

// A launch from this checkout's defaults, fitted to the build whose app receives it.
async function launchOn(build: Build, page: Page, id: string, replay: string, s: Scratch): Promise<void> {
  const input = fitTo(commandOf(build, 'session.launch')!.input, { spec: replaySpec(id, replay, { cwd: s.repo }) });
  expect(value(await invoke(page, 'session.launch', input as CommandInput<'session.launch'>))).toMatchObject({ status: 'launching' });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId })).process).toBe('ready');
}
const turnEnded = (page: Page, id: AppSessionId, timeout = 60_000) =>
  expect.poll(async () => (await statusOf(page, id)).turn === null && (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended'), { timeout, message: 'the turn has ended' }).toBe(true);
const banner = (page: Page, text: string) => page.locator('[data-banner-host]').getByRole('status').filter({ hasText: text });

// What a receiver logs when it refuses what the other build sent (src/main/hosts/supervisor.ts; src/shared/host/runtime.ts
// and socket-server.ts). A key or an event a build lacks is dropped and logged as such (DROPPED), which is no refusal.
// A handler's own output its registry refuses is logged too (`produced an invalid output`): a wire fault either way.
const MAIN_REFUSES = /\[hosts\] (?:dropped a malformed message from engine-host|dropped engine-host's invalid |engine-host answered \S+ with an invalid output|dropped engine-host's response to unknown request)|\[ipc\] \S+ produced an invalid output/;
const HOST_REFUSES = /dropped a malformed message from main|closed the client: |closed a connection: |refused to emit |\[host\] \S+ produced an invalid output/;
const DROPPED = /dropped \S+ from .*, a field this build does not know|dropped engine-host's event \S+: not in this build's event registry/;

async function crossing(s: Scratch, keeper: Build, attacher: Build, gap: { newer: Build; older: Build } | null): Promise<string[]> {
  const said: string[] = [`${keeper.label} (wire ${wireOf(keeper)}) keeps a session; ${attacher.label} (wire ${wireOf(attacher)}) attaches`];

  // the keeper: a paced replay kept across a quit, its background failure and its request still ahead
  const first = await s.launch({ MAWS_E2E_QUIT_ANSWER: 'keep', MAWS_E2E_REPLAY_ROW_MS: ROW_MS }, keeper.root);
  const own = await s.ready(first.page);
  expect(own, `${keeper.label} on its own supervisor`).toMatchObject({ matches: 'same', supervisor: { buildId: own.appBuildId } });
  const kept = own.supervisor!;
  const id = await s.record(first.page);
  const fixture = tailFixture(s.root);
  await launchOn(keeper, first.page, id, fixture, s);
  value(await invoke(first.page, 'session.send', { appSessionId: id, content: PROMPT }));
  await expect.poll(async () => (await eventsOf(first.page, id)).length, { message: 'a few rows have streamed' }).toBeGreaterThan(5);
  expect(first.maws.consoleErrors()).toEqual([]);
  await s.quit(first);
  expect(first.quitLines()).toContain('quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
  expect(isAlive(kept.pid), 'the kept supervisor outlives its app').toBe(true);
  const atQuit = s.journal(id);
  const seqAtQuit = Math.max(...atQuit.map((r) => r.seq));
  expect(atQuit.filter((r) => isTaskFailureRow(r) || isRequestRow(r)), 'the failure and the request come after the app has exited').toEqual([]);
  await expect.poll(() => s.journal(id).some(isRequestRow), { timeout: 30_000, message: 'the request reaches the journal while no app runs' }).toBe(true);

  // the other build's app attaches, and is served as another build until the kept sessions are idle
  const second = await s.launch({ MAWS_E2E_SUPERVISOR_IDLE_MS: String(IDLE_MS) }, attacher.root);
  const served = await s.ready(second.page, (st) => st.supervisor!.exitWhenIdle);
  expect(served, `${attacher.label} served by ${keeper.label}'s supervisor`).toMatchObject({ matches: 'build', supervisor: { pid: kept.pid, buildId: kept.buildId, liveSessions: 1, exitWhenIdle: true } });
  const build = served.appBuildId;
  expect(build, 'two builds').not.toBe(kept.buildId);
  await expect(banner(second.page, 'MAWS was updated.')).toContainText('1 session is still running');
  // the hello across the minor, as each end logged it
  const hello = `client connected: appPid ${second.child.pid} build ${build} wire ${wireOf(attacher)} capabilities [`;
  expect(s.log(), "host.log: the attaching app's hello, at its own minor").toContain(hello);
  const welcome = `connected to supervisor pid ${kept.pid} build ${kept.buildId} wire ${wireOf(keeper)} capabilities [`;
  expect(second.output(), "the attaching app's main: the welcome, at the supervisor's minor").toContain(welcome);
  said.push(`  hello: ${hello}…`, `  welcome: ${welcome}…`);

  // the tail: what the kept supervisor journaled while no app ran reaches this main, its live derivation included
  const atAttach = await eventsOf(second.page, id);
  const seqOf = (e: SessionEvent) => Number(suffix(e.id).split(':')[0]);
  expect(atAttach.filter((e) => seqOf(e) > seqAtQuit).length, 'events from rows journaled after the keeper had exited').toBeGreaterThan(0);
  const failure = atAttach.find((e) => e.kind === 'task.notification');
  expect(failure && seqOf(failure), 'the failure was journaled after the keeper had exited').toBeGreaterThan(seqAtQuit);
  await expect.poll(async () => (await attentionOf(second.page, id, 'error')).map((i) => i.summary), { message: 'the failure’s Needs-you item, derived from the tail' }).toEqual([`Background task failed: ${TASK_FAILED}`]);
  await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the request raised while away' }).toBe(1);
  said.push(`  tail: ${atAttach.filter((e) => seqOf(e) > seqAtQuit).length} events journaled after the keeper's quit; the failure's item and the request's reached main`);

  // across the gap: the newer build's commands, as the older supervisor answers them
  const before = gap ? await probe(second.page, gap.newer, gap.older) : null;

  // a launch on the kept supervisor plays a turn
  const launched = `xb-launch-${Date.now()}` as AppSessionId;
  await launchOn(attacher, second.page, launched, turnsJournal(s.root, 'launch', 1), s);
  value(await invoke(second.page, 'session.send', { appSessionId: launched, content: 'turn 1' }));
  await turnEnded(second.page, launched, 30_000);
  await s.ready(second.page, (st) => st.supervisor!.pid === kept.pid && st.supervisor!.liveSessions === 2); // the launch ran on the kept supervisor

  // the kept request answered through this app: the kept supervisor plays on, its rows arriving live
  await second.page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __xb: string[] }).__xb = seen;
    window.maws.on('session.eventBatch', (batch) => seen.push(...batch.events.map((e) => `${batch.appSessionId}|${e.id}`)));
  });
  const requested = atAttach.find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
  value(await invoke(second.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
  const arrived = () => second.page.evaluate((id) => (window as unknown as { __xb: string[] }).__xb.filter((k) => k.startsWith(`${id}|`)).length, id);
  await expect.poll(arrived, { message: 'rows arrive live after the answer' }).toBeGreaterThan(5);
  await turnEnded(second.page, id);
  said.push(`  served: a launch played its turn on the kept supervisor; the kept turn played on after this app's answer, ${await arrived()} rows live`);

  // the move: once both sessions are idle they are released, the kept supervisor exits, and the app starts its own
  const moved = await s.ready(second.page, (st) => st.supervisor!.pid !== kept.pid, IDLE_MS + 45_000);
  expect(moved, `${attacher.label} on a supervisor of its own build`).toMatchObject({ matches: 'same', supervisor: { buildId: build, exitWhenIdle: false } });
  await expect.poll(() => isAlive(kept.pid), { timeout: 10_000, message: 'the kept supervisor is gone' }).toBe(false);
  expect(s.lock(), 'the lock names the new supervisor').toMatchObject({ pid: moved.supervisor!.pid, buildId: build });
  expect(s.log(), 'the kept supervisor exited by itself once idle').toContain('exiting (exitWhenIdle)');
  expect(second.output()).toContain(`connected to supervisor pid ${moved.supervisor!.pid} build ${build} wire ${wireOf(attacher)} capabilities [`);
  await expect(banner(second.page, 'MAWS was updated.')).toHaveCount(0);
  await launchOn(attacher, second.page, `xb-after-${Date.now()}`, join(REPO_ROOT, PERMISSION), s);
  said.push(`  moved: supervisor pid ${kept.pid} (build ${kept.buildId}) exited when idle; pid ${moved.supervisor!.pid} (build ${build}) serves a launch`);

  // across the gap, against what the newer build's own supervisor answers
  if (gap && before) {
    const after = await probe(second.page, gap.newer, gap.older);
    for (const [name, onOlder] of before) {
      const onOwn = after.get(name)!;
      const { owner } = commandOf(gap.newer, name)!;
      expect(onOwn.ok || onOwn.code !== 'invalid_input', `${name}: its sample input is refused (${onOwn.ok ? '' : onOwn.message}); give it one in INPUTS`).toBe(true);
      if (owner === 'engine-host') {
        expect(onOwn, `${name} is served by its own build's supervisor`).not.toMatchObject({ ok: false, code: 'unknown_command' });
        expect(onOlder, `${name}, which the older supervisor lacks`).toMatchObject({ ok: false, code: 'unknown_command' });
        said.push(`  gap: ${name} (engine-host) answers unknown_command from the older supervisor and ${onOwn.ok ? 'ok' : onOwn.code} from its own`);
      } else {
        expect(onOlder, `${name} (owner ${owner}) answers alike whichever supervisor is attached`).toEqual(onOwn);
        said.push(`  gap: ${name} (${owner}) answers ${onOwn.ok ? 'ok' : onOwn.code} on either supervisor`);
      }
    }
    for (const name of addedCommands(gap.newer, gap.older).filter((name) => gap.newer.mainOnly.has(name))) said.push(`  gap: ${name} is main-only, out of a window's reach; the scenes' own traffic is its check`);
    if (addedCommands(gap.newer, gap.older).length === 0) said.push(`  gap: ${gap.newer.label} adds no command to ${gap.older.label}'s wire`);
  }

  // neither end refused what the other build sent; what either dropped as unknown is named
  const appLines = second.output().split('\n');
  const hostLines = s.log().split('\n');
  expect(appLines.filter((l) => MAIN_REFUSES.test(l)), `${attacher.label}'s main refuses nothing ${keeper.label}'s supervisor sent`).toEqual([]);
  expect(hostLines.filter((l) => HOST_REFUSES.test(l)), 'neither supervisor refuses what the other build sent').toEqual([]);
  const dropped = [...appLines, ...hostLines].filter((l) => DROPPED.test(l));
  said.push(dropped.length === 0 ? '  dropped: nothing, at either end' : `  dropped (the tolerant reader): ${dropped.map((l) => l.trim()).join(' | ')}`);
  expect(second.maws.consoleErrors()).toEqual([]);
  return said;
}

const record = (lines: string[]) => {
  test.info().annotations.push({ type: 'cross-build', description: lines.join('\n') });
  for (const line of lines) console.log(`[cross-build] ${line}`);
};

test.beforeEach(() => test.setTimeout(240_000));

test('(update) the older build’s app keeps a session; the newer build’s app attaches across the minor, is served, launches, meets what the older lacks, and moves to its own supervisor', async () => {
  const { older, newer } = builds();
  await withScratch('xb-update', async (s) => record(await crossing(s, older, newer, { newer, older })));
});

test('(downgrade) the newer build’s app keeps a session; the older build’s app attaches across the minor, is served, launches, and moves to its own supervisor', async () => {
  const { older, newer } = builds();
  await withScratch('xb-downgrade', async (s) => record(await crossing(s, newer, older, null)));
});
