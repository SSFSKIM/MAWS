// The launch decision (the P2-C document, Design §2 and §3; acceptance G1 and G2 for MAWS's side): per MAWS-owned launch,
// the desired state from the lane and the resolved style, the recorded state from the transcript, and the flags that
// bring the snapshot to the desired state; the advertisement while the lane is on; the record written at `launching`;
// and the mismatch check at the launch's first `session.init`.
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { CONTRACT_HEADER, LEGACY_CONTRACT_1, LEGACY_CONTRACT_5, LEGACY_SUPPLEMENT_1, MESSAGE_TOOL_ALIAS, messageToolHookGroup, NATIVE_TO_HUMAN_ENV, SUPPLEMENT_HEADER, TO_HUMAN_CONTRACT, TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT, TO_HUMAN_SUPPLEMENT_VERSION } from '@shared/owner/contract';
import { slugOf } from '../../engine-host/fs/paths';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { HostDispatch } from '../ipc/router';
import { decideFlags, desiredSource, laneOn, OwnerChannelLaunches, ownerChannelLaunch, type OwnerLaunchSetup } from './launch';
import type { RecordedState } from './prompt-state';

const CURRENT = `contract:${TO_HUMAN_CONTRACT_VERSION}` as const; // P4-R7: contract 7
const ADVERTISED = String(TO_HUMAN_CONTRACT_VERSION);

const SUPP = `supplement:${TO_HUMAN_SUPPLEMENT_VERSION}` as const; // P4-R7: supplement 2
const HOOKS = { SessionStart: [messageToolHookGroup()] }; // P4-R7y: a lane-on launch's SessionStart hook

it('MAWS appends contract 7 and supplement 2, and advertises 7 (P4-R7)', () => {
  expect([CURRENT, SUPP, ADVERTISED]).toEqual(['contract:7', 'supplement:2', '7']);
});

describe('decideFlags: the decision table (Design §2; P2-C2 adds the supplement), with the flag declared', () => {
  const cell = (desired: Parameters<typeof decideFlags>[0], recorded: RecordedState) => {
    const { append, off, applied } = decideFlags(desired, recorded, true);
    return { append, off, applied };
  };
  it.each([
    ['maws-contract', 'unrecorded', { append: 'contract', off: false, applied: 'maws-contract' }],
    ['maws-contract', CURRENT, { append: 'contract', off: false, applied: 'maws-contract' }],
    ['maws-contract', 'contract:2', { append: 'contract', off: true, applied: 'maws-contract' }],
    ['maws-contract', SUPP, { append: 'contract', off: true, applied: 'maws-contract' }],
    ['maws-contract', 'none', { append: 'contract', off: true, applied: 'maws-contract' }],
    ['external-compatible-style', 'unrecorded', { append: null, off: false, applied: 'external-compatible-style' }],
    ['external-compatible-style', CURRENT, { append: null, off: true, applied: 'external-compatible-style' }],
    ['external-compatible-style', 'contract:2', { append: null, off: true, applied: 'external-compatible-style' }],
    ['external-compatible-style', SUPP, { append: null, off: true, applied: 'external-compatible-style' }],
    ['external-compatible-style', 'none', { append: null, off: false, applied: 'external-compatible-style' }],
    ['external-style-plus-supplement', 'unrecorded', { append: 'supplement', off: false, applied: 'external-style-plus-supplement' }],
    ['external-style-plus-supplement', CURRENT, { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }], // the contract leaves at once
    ['external-style-plus-supplement', 'contract:1', { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }],
    ['maws-contract', 'contract:1', { append: 'contract', off: true, applied: 'maws-contract' }], // contract 1 gives way to 7 at once
    ['maws-contract', 'contract:5', { append: 'contract', off: true, applied: 'maws-contract' }], // P4-R7: so does contract 5
    ['external-style-plus-supplement', 'contract:5', { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }],
    ['external-compatible-style', 'contract:5', { append: null, off: true, applied: 'external-compatible-style' }],
    ['external-style-plus-supplement', SUPP, { append: 'supplement', off: false, applied: 'external-style-plus-supplement' }],
    ['external-style-plus-supplement', 'supplement:1', { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }], // P4-R7: supplement 1 gives way to 2
    ['maws-contract', 'supplement:1', { append: 'contract', off: true, applied: 'maws-contract' }],
    ['external-style-plus-supplement', 'supplement:3', { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }], // a version MAWS never appended
    ['external-style-plus-supplement', 'none', { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }],
    ['off', 'unrecorded', { append: null, off: false, applied: 'off' }],
    ['off', CURRENT, { append: null, off: true, applied: 'off' }],
    ['off', 'contract:2', { append: null, off: true, applied: 'off' }],
    ['off', SUPP, { append: null, off: true, applied: 'off' }],
    ['off', 'none', { append: null, off: false, applied: 'off' }],
    // P4-A2: the alias recorded alone (a compatible style under hooks none) is what no other launch should reuse
    ['off', 'alias', { append: null, off: true, applied: 'off' }],
    ['external-compatible-style', 'alias', { append: null, off: true, applied: 'external-compatible-style' }], // hooks user: the group gives it
    ['maws-contract', 'alias', { append: 'contract', off: true, applied: 'maws-contract' }],
    ['external-style-plus-supplement', 'alias', { append: 'supplement', off: true, applied: 'external-style-plus-supplement' }],
  ] as const)('desired %s, recorded %s', (desired, recorded, expected) => {
    expect(cell(desired, recorded)).toEqual(expected);
  });
});

describe('decideFlags without the flag: applied stays what the snapshot keeps, until the next compaction', () => {
  const appends = { 'maws-contract': 'contract', 'external-style-plus-supplement': 'supplement' } as Record<string, string>;
  it.each([
    ['maws-contract', 'contract:2', 'maws-contract'],
    ['maws-contract', 'none', 'off'],
    ['maws-contract', SUPP, 'external-style-plus-supplement'],
    ['external-compatible-style', CURRENT, 'maws-contract'],
    ['external-compatible-style', SUPP, 'external-style-plus-supplement'],
    ['external-style-plus-supplement', CURRENT, 'maws-contract'],
    ['external-style-plus-supplement', 'none', 'external-compatible-style'], // the style in effect, its supplement missing
    ['off', CURRENT, 'maws-contract'],
    ['off', 'contract:2', 'maws-contract'],
    ['off', SUPP, 'external-style-plus-supplement'],
    // P4-R7: a session recorded under contract 5 or supplement 1 keeps it, the message rule missing, until it compacts
    ['maws-contract', 'contract:5', 'maws-contract'],
    ['external-style-plus-supplement', 'supplement:1', 'external-style-plus-supplement'],
    ['external-style-plus-supplement', 'contract:5', 'maws-contract'],
    // P4-A2: the alias alone carries none of MAWS's texts, so it keeps what none keeps
    ['off', 'alias', 'off'],
    ['maws-contract', 'alias', 'off'],
    ['external-compatible-style', 'alias', 'external-compatible-style'],
  ] as const)('desired %s, recorded %s: no "off", applied %s', (desired, recorded, applied) => {
    expect(decideFlags(desired, recorded, false)).toEqual({ append: appends[desired] ?? null, off: false, offUnavailable: true, applied });
  });
  it('an unwanted "off" is never unavailable', () => {
    expect(decideFlags('maws-contract', CURRENT, false)).toEqual({ append: 'contract', off: false, offUnavailable: false, applied: 'maws-contract' });
    expect(decideFlags('external-style-plus-supplement', SUPP, false)).toEqual({ append: 'supplement', off: false, offUnavailable: false, applied: 'external-style-plus-supplement' });
    expect(decideFlags('off', 'none', false)).toEqual({ append: null, off: false, offUnavailable: false, applied: 'off' });
  });
});

// P4-A2: under the launch profile's hooks `none` MAWS's start-time context is appended to the system prompt, which a
// reused snapshot would leave out, so every launch reusing a recorded prompt renders it live where the binary can
describe('decideFlags with the alias appended (the launch profile’s hooks none)', () => {
  it.each([
    ['maws-contract', CURRENT],
    ['external-style-plus-supplement', SUPP],
    ['external-compatible-style', 'none'],
  ] as const)('desired %s over its own recorded %s: "off" all the same', (desired, recorded) => {
    expect(decideFlags(desired, recorded, true)).toMatchObject({ off: false });
    expect(decideFlags(desired, recorded, true, true)).toMatchObject({ off: true, offUnavailable: false, applied: desired });
    expect(decideFlags(desired, recorded, false, true)).toMatchObject({ off: false, offUnavailable: true });
  });
  it('a new session (nothing recorded) renders live anyway: no "off"', () => {
    expect(decideFlags('maws-contract', 'unrecorded', true, true)).toEqual({ append: 'contract', off: false, offUnavailable: false, applied: 'maws-contract' });
  });
});

describe('desiredSource: the shape rule (P2-C2)', () => {
  it.each([
    [true, 'marks', 'external-compatible-style'],
    [true, 'message-tool', 'external-style-plus-supplement'],
    [true, 'none', 'maws-contract'],
    [false, 'marks', 'off'],
    [false, 'message-tool', 'off'],
    [false, 'none', 'off'],
  ] as const)('lane on %s, shape %s: %s', (on, shape, source) => {
    expect(desiredSource(on, { shape, contract: shape === 'marks' ? 1 : shape === 'message-tool' ? 4 : null })).toBe(source);
  });

  it('a style declaring MAWS’s own full contract (7) gets nothing appended; every other message-tool style gets the supplement', () => {
    expect(desiredSource(true, { shape: 'message-tool', contract: 7 })).toBe('external-compatible-style');
    for (const contract of [3, 4, 5, 6, 8]) expect(desiredSource(true, { shape: 'message-tool', contract })).toBe('external-style-plus-supplement'); // P4-R7: 5 lacks the message rule
    expect(desiredSource(false, { shape: 'message-tool', contract: 7 })).toBe('off');
  });
});

describe('the lane', () => {
  it('is the override when set, else the app’s switch', () => {
    expect(laneOn(true, 'inherit')).toBe(true);
    expect(laneOn(false, 'inherit')).toBe(false);
    expect(laneOn(false, 'on')).toBe(true);
    expect(laneOn(true, 'off')).toBe(false);
  });
});

describe('ownerChannelLaunch over a scratch config home', () => {
  let root: string;
  let configHome: string;
  let work: string;
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let appEnabled: boolean;
  let declares: boolean | undefined;
  let binaryCalls: number;
  let launches: OwnerChannelLaunches;
  let s: OwnerLaunchSetup;
  let record: AppSessionId;
  const ENGINE_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
  const AT = '2026-10-09T10:00:00.000Z';

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-owner-launch-')));
    configHome = join(root, 'engine-config');
    work = join(root, 'work');
    mkdirSync(configHome, { recursive: true });
    mkdirSync(work, { recursive: true });
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    record = index.sessions.upsertFromSummary(summary({ sessionId: ENGINE_ID, directory: work })).record.appId;
    appEnabled = true;
    declares = true;
    binaryCalls = 0;
    const dispatch: HostDispatch = async (_owner, name) => {
      if (name !== 'engine.binaryInfo') throw new Error(`unexpected ${name}`);
      binaryCalls += 1;
      return { ok: true, value: { path: '/bin/claude', testedVersion: '2.1.293', version: '2.1.295', ok: true, error: null, ...(declares === undefined ? {} : { declaresSystemPromptSnapshot: declares }) } };
    };
    launches = new OwnerChannelLaunches({ store: index.ownerChannel, appEnabled: () => appEnabled, managedSettingsPath: join(root, 'managed.json'), log: () => {} });
    s = { env: { HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: configHome }, dispatch, sessions: index.sessions, log: () => {}, owner: launches };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    index.close();
    dir.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  const spec = (over: Partial<LaunchSpec> = {}): LaunchSpec =>
    LaunchSpecSchema.parse({
      appSessionId: record, cwd: work, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null, ...over,
    });
  const resumeSpec = (over: Partial<LaunchSpec> = {}) => spec({ resume: { sessionId: ENGINE_ID, fork: false }, ...over });
  const put = (path: string, content: string | object) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  };
  // The transcript the resume reads, under the config home of the given environment
  const snapshotLine = (lastSegment: string | null) =>
    `${JSON.stringify({ type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: ['You are an agent.', ...(lastSegment === null ? [] : [lastSegment])] } })}\n`;
  const transcriptPath = (home: string) => join(home, 'projects', slugOf(work), `${ENGINE_ID}.jsonl`);
  const transcript = (home: string, lastSegment: string | null) => put(transcriptPath(home), snapshotLine(lastSegment));
  // a later launch rendering anew records another snapshot (the engine only ever appends)
  const recordSnapshot = (home: string, lastSegment: string | null) => appendFileSync(transcriptPath(home), snapshotLine(lastSegment));
  const compatibleStyle = (home: string) => {
    put(join(home, 'output-styles/report.md'), '---\nname: report\nmaws-to-human-contract: 1\n---\nbody\n');
    put(join(home, 'settings.json'), { outputStyle: 'report' });
  };
  const init = (outputStyle: string | null, seq: number | null = 1) =>
    ({ id: `e${seq}`, sessionId: ENGINE_ID, at: AT, seq, agentId: null, parentToolUseId: null, kind: 'session.init', outputStyle }) as unknown as SessionEvent;

  it('a new session with the lane on appends the contract, sets the variable and records unrecorded → maws-contract', async () => {
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec({ extraSettings: { env: { CUA_BROWSER_BACKENDS: '/sock' } } }), { kind: 'new', transcriptOf: null });
    expect(decided.appendSystemPrompt).toBe(TO_HUMAN_CONTRACT);
    expect(decided.appendSystemPrompt!.startsWith(CONTRACT_HEADER(7))).toBe(true); // P4-R7
    expect(decided.systemPromptSnapshot ?? null).toBeNull();
    expect(decided.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/sock', [NATIVE_TO_HUMAN_ENV]: ADVERTISED }, hooks: HOOKS });
    expect(decision).toMatchObject({ appSessionId: record, laneOn: true, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, applied: 'maws-contract', style: 'default' });
    expect(binaryCalls).toBe(0); // "off" was never wanted
    launches.launched(decision!, { launchId: 'l1', at: AT });
    expect(index.ownerChannel.session(record)).toMatchObject({ launchId: 'l1', launchedAt: AT, enabledAt: AT, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, applied: 'maws-contract', style: 'default' });
  });

  it('with a compatible style selected, appends nothing, keeps the variable, and records external-compatible-style', async () => {
    compatibleStyle(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decided.extraSettings).toEqual({ env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED }, hooks: HOOKS });
    expect(decision).toMatchObject({ desired: 'external-compatible-style', applied: 'external-compatible-style', style: 'report' });
  });

  // P2-C2: the owner's parity answer; a session MAWS gave contract 1 gets contract 5 at its next launch
  it('a session recorded under contract 1, no style: contract 5 appended and "off" passed, once', async () => {
    transcript(configHome, LEGACY_CONTRACT_1.text);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_CONTRACT, systemPromptSnapshot: 'off' });
    expect(decision).toMatchObject({ desired: 'maws-contract', recorded: 'contract:1', snapshotOff: true, applied: 'maws-contract' });
    recordSnapshot(configHome, TO_HUMAN_CONTRACT);
    expect((await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record })).record).toMatchObject({ recorded: CURRENT, snapshotOff: false });
  });

  // P4-R7: a session MAWS gave contract 5 gets contract 7 (the message rule) at its next launch, as contract 1 got 5
  it('a session recorded under contract 5, no style: contract 7 appended and "off" passed, once', async () => {
    transcript(configHome, LEGACY_CONTRACT_5.text);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_CONTRACT, systemPromptSnapshot: 'off', extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: '7' } } });
    expect(decision).toMatchObject({ desired: 'maws-contract', recorded: 'contract:5', snapshotOff: true, applied: 'maws-contract' });
    recordSnapshot(configHome, TO_HUMAN_CONTRACT);
    expect((await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record })).record).toMatchObject({ recorded: 'contract:7', snapshotOff: false });
  });

  it('a session recorded under supplement 1 beside a contract-4 style gets supplement 2 and "off", once', async () => {
    transcript(configHome, LEGACY_SUPPLEMENT_1.text);
    messageToolStyle(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off' });
    expect(decision).toMatchObject({ desired: 'external-style-plus-supplement', recorded: 'supplement:1', snapshotOff: true, applied: 'external-style-plus-supplement' });
    recordSnapshot(configHome, TO_HUMAN_SUPPLEMENT);
    expect((await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record })).record).toMatchObject({ recorded: 'supplement:2', snapshotOff: false });
  });

  // P2-C2 (Decision Log 31): a message-tool style (the owner's doperpowers at 7.149.0 declares 4)
  const messageToolStyle = (home: string, declared = 4) => {
    put(join(home, 'output-styles/report.md'), `---\nname: report\nmaws-to-human-contract: ${declared}\n---\nbody\n`);
    put(join(home, 'settings.json'), { outputStyle: 'report' });
  };

  it('with a message-tool style selected, appends the supplement and never the contract, keeps the variable, and records the supplemented source', async () => {
    messageToolStyle(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
    expect(decided.appendSystemPrompt).toBe(TO_HUMAN_SUPPLEMENT);
    expect(decided.appendSystemPrompt).not.toContain(CONTRACT_HEADER(TO_HUMAN_CONTRACT_VERSION));
    expect(decided.systemPromptSnapshot ?? null).toBeNull();
    expect(decided.extraSettings).toEqual({ env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED }, hooks: HOOKS });
    expect(decision).toMatchObject({ desired: 'external-style-plus-supplement', recorded: 'unrecorded', appended: true, snapshotOff: false, applied: 'external-style-plus-supplement', style: 'report' });
    launches.launched(decision!, { launchId: 'l1', at: AT });
    expect(index.ownerChannel.session(record)).toMatchObject({ desired: 'external-style-plus-supplement', appended: true, applied: 'external-style-plus-supplement' });
  });

  it('a session that started under contract 1 and now has a contract-4 style gets the supplement and loses contract 1 at its next launch', async () => {
    transcript(configHome, LEGACY_CONTRACT_1.text);
    messageToolStyle(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off' });
    expect(decision).toMatchObject({ desired: 'external-style-plus-supplement', recorded: 'contract:1', appended: true, snapshotOff: true, applied: 'external-style-plus-supplement' });
    // once the session renders and records the supplement, later launches reuse it: no "off"
    recordSnapshot(configHome, TO_HUMAN_SUPPLEMENT);
    const next = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(next.spec.systemPromptSnapshot ?? null).toBeNull();
    expect(next.record).toMatchObject({ recorded: SUPP, appended: true, snapshotOff: false, applied: 'external-style-plus-supplement' });
    expect(binaryCalls).toBe(1); // asked once, for the launch that wanted "off"
  });

  it('a style moving back from 4 to 2 drops the recorded supplement; a key bump keeping the shape changes nothing', async () => {
    transcript(configHome, `${SUPPLEMENT_HEADER(TO_HUMAN_SUPPLEMENT_VERSION)}\n\nthe supplement`);
    messageToolStyle(configHome, 2);
    const marks = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(marks.spec.appendSystemPrompt ?? null).toBeNull();
    expect(marks.record).toMatchObject({ desired: 'external-compatible-style', recorded: SUPP, snapshotOff: true, applied: 'external-compatible-style' });
    messageToolStyle(configHome, 9);
    const later = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(later.spec.appendSystemPrompt).toBe(TO_HUMAN_SUPPLEMENT);
    expect(later.record).toMatchObject({ desired: 'external-style-plus-supplement', recorded: SUPP, snapshotOff: false });
  });

  // P4-R7: the plugin's style with its message tool keeps the shape and gets the same supplement; MAWS's own 7 none
  it('a style declaring 6 gets supplement 2; one declaring 7 carries the contract and gets nothing', async () => {
    messageToolStyle(configHome, 6);
    const six = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
    expect(six.spec.appendSystemPrompt).toBe(TO_HUMAN_SUPPLEMENT);
    expect(six.record).toMatchObject({ desired: 'external-style-plus-supplement', applied: 'external-style-plus-supplement' });
    messageToolStyle(configHome, 7);
    const seven = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
    expect(seven.spec.appendSystemPrompt ?? null).toBeNull();
    expect(seven.record).toMatchObject({ desired: 'external-compatible-style', applied: 'external-compatible-style' });
  });

  it('a resume with the override off over a recorded contract passes "off", no append and no variable', async () => {
    transcript(configHome, TO_HUMAN_CONTRACT);
    index.ownerChannel.setOverride(record, 'off');
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ systemPromptSnapshot: 'off', extraSettings: null });
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decision).toMatchObject({ laneOn: false, override: 'off', desired: 'off', recorded: CURRENT, appended: false, snapshotOff: true, applied: 'off' });
    launches.launched(decision!, { launchId: 'l2', at: AT });
    expect(index.ownerChannel.session(record)).toMatchObject({ enabledAt: null, applied: 'off', snapshotOff: true });
  });

  it('turned on again over a session that recorded none: the append, the flag and the variable', async () => {
    transcript(configHome, null);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_CONTRACT, systemPromptSnapshot: 'off', extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED } } });
    expect(decision).toMatchObject({ recorded: 'none', snapshotOff: true, applied: 'maws-contract' });
  });

  it('a binary without the flag: no "off", applied stays the snapshot’s, and the decision says the change waits', async () => {
    for (const answer of [false, undefined]) {
      declares = answer;
      transcript(configHome, null);
      const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(decided.systemPromptSnapshot ?? null).toBeNull();
      expect(decided.appendSystemPrompt).toBe(TO_HUMAN_CONTRACT);
      expect(decision).toMatchObject({ snapshotOff: false, offUnavailable: true, applied: 'off' });
      launches.launched(decision!, { launchId: 'l1', at: AT });
      expect(index.ownerChannel.session(record)).toMatchObject({ snapshotOff: false, offUnavailable: true, applied: 'off' });
    }
  });

  it('a fork reads its parent’s transcript', async () => {
    transcript(configHome, `${CONTRACT_HEADER(5)}\n\nan older contract`);
    const child = index.sessions.upsertFromSummary(summary({ directory: work })).record.appId;
    const forked = spec({ appSessionId: child, resume: { sessionId: ENGINE_ID, fork: true }, inheritGrantsFrom: record });
    const { record: decision } = await ownerChannelLaunch(s, forked, { kind: 'fork', transcriptOf: record });
    expect(decision).toMatchObject({ appSessionId: child, recorded: 'contract:5', appended: true, snapshotOff: true });
  });

  it('reads the config home of the engine’s environment (s.env), never main’s process.env', async () => {
    const mainHome = join(root, 'main-config');
    vi.stubEnv('CLAUDE_CONFIG_DIR', mainHome);
    compatibleStyle(mainHome); // a style only main's own environment would find
    transcript(mainHome, TO_HUMAN_CONTRACT);
    transcript(configHome, null); // the engine's home: no contract recorded
    const { record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decision).toMatchObject({ desired: 'maws-contract', recorded: 'none', style: 'default' });
  });

  it('the app switch off, and no override: the lane is off and nothing is appended', async () => {
    appEnabled = false;
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
    expect(decided.extraSettings).toBeNull();
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decision).toMatchObject({ laneOn: false, desired: 'off', applied: 'off' });
    index.ownerChannel.setOverride(record, 'on');
    expect((await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null })).record).toMatchObject({ laneOn: true, override: 'on', desired: 'maws-contract' });
  });

  // P4-R7y (the owner's ask of 2026-10-21): the SessionStart hook goes exactly where the advertisement goes
  it('every launch kind carries MAWS’s SessionStart hook in its settings while the lane is on, beside the advertisement, and none while it is off', async () => {
    transcript(configHome, TO_HUMAN_CONTRACT);
    const child = index.sessions.upsertFromSummary(summary({ directory: work })).record.appId;
    const kinds = [
      { kind: 'new' as const, spec: spec(), transcriptOf: null },
      { kind: 'fork' as const, spec: spec({ appSessionId: child, resume: { sessionId: ENGINE_ID, fork: true }, inheritGrantsFrom: record }), transcriptOf: record },
      { kind: 'resume' as const, spec: resumeSpec(), transcriptOf: record },
    ];
    for (const on of [true, false]) {
      appEnabled = on;
      for (const { kind, spec: given, transcriptOf } of kinds) {
        const { spec: decided, record: decision } = await ownerChannelLaunch(s, given, { kind, transcriptOf });
        expect(decision, `${kind}, lane ${on ? 'on' : 'off'}`).toMatchObject({ kind, laneOn: on });
        const settings = decided.extraSettings as { env?: Record<string, string>; hooks?: unknown } | null;
        expect(settings?.hooks ?? null, `${kind}, lane ${on ? 'on' : 'off'}`).toEqual(on ? HOOKS : null);
        expect(settings?.env?.[NATIVE_TO_HUMAN_ENV] ?? null).toBe(on ? ADVERTISED : null);
        expect(LaunchSpecSchema.parse(decided)).toEqual(decided);
      }
    }
  });

  // P4-A2: the launch profile's hooks `none` (`disableAllHooks` in the spec's settings) silences MAWS's SessionStart
  // group, so the alias rides the appended prompt, rendered live at every launch that would reuse a recorded one
  it('under hooks none: the alias after the contract and no SessionStart group, and "off" over a resumed or forked transcript, lane on only', async () => {
    const hooksNone = { extraSettings: { disableAllHooks: true } };
    const fresh = await ownerChannelLaunch(s, spec(hooksNone), { kind: 'new', transcriptOf: null });
    expect(fresh.spec.appendSystemPrompt).toBe(`${TO_HUMAN_CONTRACT}\n\n${MESSAGE_TOOL_ALIAS}`);
    expect(fresh.spec.systemPromptSnapshot ?? null).toBeNull();
    expect(fresh.spec.extraSettings).toEqual({ disableAllHooks: true, env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED } });
    expect(fresh.record).toMatchObject({ desired: 'maws-contract', appended: true, snapshotOff: false });
    transcript(configHome, TO_HUMAN_CONTRACT); // recorded under the current contract, without the alias
    expect((await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record })).spec.systemPromptSnapshot ?? null).toBeNull(); // hooks on: reused as before
    const resumed = await ownerChannelLaunch(s, resumeSpec(hooksNone), { kind: 'resume', transcriptOf: record });
    expect(resumed.spec).toMatchObject({ appendSystemPrompt: `${TO_HUMAN_CONTRACT}\n\n${MESSAGE_TOOL_ALIAS}`, systemPromptSnapshot: 'off' });
    expect(resumed.record).toMatchObject({ recorded: CURRENT, snapshotOff: true, applied: 'maws-contract' });
    const child = index.sessions.upsertFromSummary(summary({ directory: work })).record.appId;
    const forked = await ownerChannelLaunch(s, spec({ ...hooksNone, appSessionId: child, resume: { sessionId: ENGINE_ID, fork: true }, inheritGrantsFrom: record }), { kind: 'fork', transcriptOf: record });
    expect(forked.spec).toMatchObject({ systemPromptSnapshot: 'off' });
    expect(forked.spec.appendSystemPrompt).toContain(MESSAGE_TOOL_ALIAS);
    appEnabled = false; // the plugin's tool is real again: no alias, and the recorded contract leaves as before
    const off = await ownerChannelLaunch(s, resumeSpec(hooksNone), { kind: 'resume', transcriptOf: record });
    expect(off.spec.appendSystemPrompt ?? null).toBeNull();
    expect(off.spec.extraSettings).toEqual({ disableAllHooks: true });
  });

  // P4-A2: a compatible style under hooks none gets the alias alone, which the engine records as its own segment; a launch
  // that no longer wants it in the prompt (the lane off, where the plugin's tool is real; or hooks user, where the group
  // gives it) renders anew instead of reusing it
  it('under hooks none with a compatible style: the alias alone, and its snapshot rendered anew once the lane is off or hooks are the user’s', async () => {
    compatibleStyle(configHome);
    const hooksNone = { extraSettings: { disableAllHooks: true } };
    const fresh = await ownerChannelLaunch(s, spec(hooksNone), { kind: 'new', transcriptOf: null });
    expect(fresh.spec.appendSystemPrompt).toBe(MESSAGE_TOOL_ALIAS);
    expect(fresh.spec.extraSettings).toEqual({ disableAllHooks: true, env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED } });
    expect(fresh.record).toMatchObject({ desired: 'external-compatible-style', appended: true, snapshotOff: false });
    transcript(configHome, MESSAGE_TOOL_ALIAS);

    appEnabled = false;
    const resumed = await ownerChannelLaunch(s, resumeSpec(hooksNone), { kind: 'resume', transcriptOf: record });
    expect(resumed.spec).toMatchObject({ systemPromptSnapshot: 'off', extraSettings: { disableAllHooks: true } });
    expect(resumed.spec.appendSystemPrompt ?? null).toBeNull();
    expect(resumed.record).toMatchObject({ laneOn: false, desired: 'off', recorded: 'alias', appended: false, snapshotOff: true, applied: 'off' });
    const child = index.sessions.upsertFromSummary(summary({ directory: work })).record.appId;
    const forked = await ownerChannelLaunch(s, spec({ ...hooksNone, appSessionId: child, resume: { sessionId: ENGINE_ID, fork: true }, inheritGrantsFrom: record }), { kind: 'fork', transcriptOf: record });
    expect(forked.spec).toMatchObject({ systemPromptSnapshot: 'off', extraSettings: { disableAllHooks: true } });
    expect(forked.spec.appendSystemPrompt ?? null).toBeNull();
    expect(forked.record).toMatchObject({ laneOn: false, recorded: 'alias', snapshotOff: true, applied: 'off' });

    appEnabled = true;
    const user = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(user.spec).toMatchObject({ systemPromptSnapshot: 'off', extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED }, hooks: HOOKS } });
    expect(user.spec.appendSystemPrompt ?? null).toBeNull();
    expect(user.record).toMatchObject({ desired: 'external-compatible-style', recorded: 'alias', snapshotOff: true, applied: 'external-compatible-style' });
  });

  it('without the owner channel (no index), the spec goes unchanged and nothing is recorded', async () => {
    const plain = spec();
    expect(await ownerChannelLaunch({ ...s, owner: null }, plain, { kind: 'new', transcriptOf: null })).toEqual({ spec: plain, record: null });
  });

  describe('the mismatch check (Design §2)', () => {
    it('records the engine’s style at the decided launch’s first live init, and decides the next launch by it', async () => {
      compatibleStyle(configHome); // the resolver reads "report", compatible
      const first = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
      expect(first.record).toMatchObject({ style: 'report', decidedBy: 'report', desired: 'external-compatible-style' });
      launches.launched(first.record!, { launchId: 'l1', at: AT });
      launches.observe(record, [init('default', null)]); // a backfill's init is no observation
      expect(index.ownerChannel.session(record)).toMatchObject({ observedStyle: null, styleMismatch: false });
      launches.observe(record, [init(null)]); // null reads as the default
      expect(index.ownerChannel.session(record)).toMatchObject({ style: 'report', observedStyle: 'default', styleMismatch: true });
      launches.observe(record, [init('report', 2)]); // only the first init after the launch counts
      expect(index.ownerChannel.session(record)).toMatchObject({ observedStyle: 'default', styleMismatch: true });

      // the settings still read "report": the next decision goes by the engine's "default", the resolver's reading kept
      const second = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(second.record).toMatchObject({ style: 'report', decidedBy: 'default', desired: 'maws-contract', appended: true });
    });

    it('a persistent misreading keeps deciding by the engine’s name, launch after launch, without alternating', async () => {
      compatibleStyle(configHome); // the resolver reads "report"; the engine keeps reporting the default
      const first = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
      expect(first.record).toMatchObject({ style: 'report', desired: 'external-compatible-style', appended: false });
      launches.launched(first.record!, { launchId: 'l1', at: AT });
      launches.observe(record, [init('default', 1)]);

      transcript(configHome, null); // launch 1 recorded no contract
      for (const [n, recorded] of [[2, 'none'], [3, CURRENT], [4, CURRENT]] as const) {
        const next = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
        // decided by the engine's "default" each time: the contract is wanted, and once recorded never switched off again
        expect(next.record).toMatchObject({
          style: 'report', decidedBy: 'default', desired: 'maws-contract', recorded, appended: true, snapshotOff: recorded !== CURRENT, applied: 'maws-contract',
        });
        launches.launched(next.record!, { launchId: `l${n}`, at: AT });
        launches.observe(record, [init('default', n)]); // the engine agrees with the name the launch decided by, never with the resolver
        expect(index.ownerChannel.session(record)).toMatchObject({ style: 'report', observedStyle: 'default', styleMismatch: true });
        if (recorded !== CURRENT) recordSnapshot(configHome, TO_HUMAN_CONTRACT); // the session compacts and records the appended contract
      }
    });

    it('a settings change the engine then reports alike clears the mismatch, and the settings decide again', async () => {
      compatibleStyle(configHome);
      const first = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
      launches.launched(first.record!, { launchId: 'l1', at: AT });
      launches.observe(record, [init('default', 1)]);
      transcript(configHome, TO_HUMAN_CONTRACT);

      // the owner selects another compatible style, and the engine reads it as the resolver does
      put(join(configHome, 'output-styles/brief.md'), '---\nname: brief\nmaws-to-human-contract: 1\n---\nbody\n');
      put(join(configHome, 'settings.json'), { outputStyle: 'brief' });
      const second = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(second.record).toMatchObject({ style: 'brief', decidedBy: 'default', desired: 'maws-contract' }); // agreement not yet observed
      launches.launched(second.record!, { launchId: 'l2', at: AT });
      launches.observe(record, [init('brief', 2)]);
      expect(index.ownerChannel.session(record)).toMatchObject({ style: 'brief', observedStyle: 'brief', styleMismatch: false });

      const third = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(third.record).toMatchObject({
        style: 'brief', decidedBy: 'brief', desired: 'external-compatible-style', recorded: CURRENT, snapshotOff: true, applied: 'external-compatible-style',
      });
    });

    it('ignores an init for a session with no decided launch awaiting one', () => {
      launches.observe(record, [init('Explanatory')]);
      expect(index.ownerChannel.session(record)).toBeNull();
    });
  });
});
