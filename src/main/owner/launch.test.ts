// The launch decision (the P2-C document, Design §2 and §3; acceptance G1 and G2 for MAWS's side): per MAWS-owned launch,
// the desired state from the lane and the resolved style, the recorded state from the transcript, and the flags that
// bring the snapshot to the desired state; the advertisement while the lane carries the plugin's message tool; the record
// written at `launching`; and the mismatch check at the launch's first `session.init`. P4-R7z (the P4 spec's Decision
// Log 92): only a style declaring the to-human plugin's message tool carries the lane, with supplement 3 beside it.
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import {
  CONTRACT_HEADER, LEGACY_CONTRACT_1, LEGACY_CONTRACT_5, LEGACY_CONTRACT_7, LEGACY_MESSAGE_TOOL_ALIAS, LEGACY_SUPPLEMENT_1, LEGACY_SUPPLEMENT_2, NATIVE_TO_HUMAN_ENV, SUPPLEMENT_HEADER,
  TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT, TO_HUMAN_SUPPLEMENT_VERSION,
} from '@shared/owner/contract';
import { slugOf } from '../../engine-host/fs/paths';
import { installToHumanPlugin, PLUGIN_STYLE } from '../../../test/support/to-human-plugin';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { HostDispatch } from '../ipc/router';
import { decideFlags, desiredSource, laneOn, OwnerChannelLaunches, ownerChannelLaunch, type OwnerLaunchSetup } from './launch';
import type { RecordedState } from './prompt-state';

const SUPP = `supplement:${TO_HUMAN_SUPPLEMENT_VERSION}` as const; // P4-R7z: supplement 3
const ADVERTISED = String(TO_HUMAN_CONTRACT_VERSION);

it('MAWS appends supplement 3 and advertises 8, MAWS offering no message tool (P4-R7z)', () => {
  expect([SUPP, ADVERTISED]).toEqual(['supplement:3', '8']);
});

describe('decideFlags: the decision table (Design §2; P2-C2 adds the supplement), with the flag declared', () => {
  const cell = (desired: Parameters<typeof decideFlags>[0], recorded: RecordedState) => {
    const { append, off, applied } = decideFlags(desired, recorded, true);
    return { append, off, applied };
  };
  const SUPPLEMENTED = { append: 'supplement', off: true, applied: 'external-style-plus-supplement' } as const;
  const OFF = { append: null, off: true, applied: 'off' } as const;
  it.each([
    ['external-style-plus-supplement', 'unrecorded', { append: 'supplement', off: false, applied: 'external-style-plus-supplement' }],
    ['external-style-plus-supplement', SUPP, { append: 'supplement', off: false, applied: 'external-style-plus-supplement' }],
    // P4-R7z: everything MAWS appended before supplement 3 gives way to it at once
    ['external-style-plus-supplement', 'supplement:2', SUPPLEMENTED],
    ['external-style-plus-supplement', 'supplement:1', SUPPLEMENTED],
    ['external-style-plus-supplement', 'contract:7', SUPPLEMENTED],
    ['external-style-plus-supplement', 'contract:5', SUPPLEMENTED],
    ['external-style-plus-supplement', 'contract:1', SUPPLEMENTED],
    ['external-style-plus-supplement', 'alias', SUPPLEMENTED],
    ['external-style-plus-supplement', 'supplement:4', SUPPLEMENTED], // a version MAWS never appended
    ['external-style-plus-supplement', 'none', SUPPLEMENTED],
    ['off', 'unrecorded', { append: null, off: false, applied: 'off' }],
    ['off', 'none', { append: null, off: false, applied: 'off' }],
    ['off', 'contract:7', OFF],
    ['off', 'contract:1', OFF],
    ['off', 'supplement:2', OFF],
    ['off', SUPP, OFF],
    ['off', 'alias', OFF],
  ] as const)('desired %s, recorded %s', (desired, recorded, expected) => {
    expect(cell(desired, recorded)).toEqual(expected);
  });
});

describe('decideFlags without the flag: applied stays what the snapshot keeps, until the next compaction', () => {
  const appends = { 'external-style-plus-supplement': 'supplement' } as Record<string, string>;
  it.each([
    ['external-style-plus-supplement', 'contract:7', 'maws-contract'], // MAWS's former contract stays in force
    ['external-style-plus-supplement', 'supplement:2', 'external-style-plus-supplement'],
    ['external-style-plus-supplement', 'none', 'external-compatible-style'], // the style in effect, its supplement missing
    ['external-style-plus-supplement', 'alias', 'external-compatible-style'], // the alias alone carries none of MAWS's texts
    ['off', 'contract:7', 'maws-contract'],
    ['off', 'supplement:2', 'external-style-plus-supplement'],
    ['off', 'alias', 'off'],
  ] as const)('desired %s, recorded %s: no "off", applied %s', (desired, recorded, applied) => {
    expect(decideFlags(desired, recorded, false)).toEqual({ append: appends[desired] ?? null, off: false, offUnavailable: true, applied });
  });
  it('an unwanted "off" is never unavailable', () => {
    expect(decideFlags('external-style-plus-supplement', SUPP, false)).toEqual({ append: 'supplement', off: false, offUnavailable: false, applied: 'external-style-plus-supplement' });
    expect(decideFlags('off', 'none', false)).toEqual({ append: null, off: false, offUnavailable: false, applied: 'off' });
  });
});

describe('desiredSource: the lane carried only where the plugin registers its message tool (P4-R7z)', () => {
  it('the supplement with the lane on and the tool, off otherwise', () => {
    expect(desiredSource(true, { messageTool: true })).toBe('external-style-plus-supplement');
    expect(desiredSource(true, { messageTool: false })).toBe('off');
    expect(desiredSource(false, { messageTool: true })).toBe('off');
    expect(desiredSource(false, { messageTool: false })).toBe('off');
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
  // The to-human plugin's style selected, declaring `declared` (6: its message tool), the plugin enabled beside it
  const style = (home: string, declared = 6) => installToHumanPlugin(home, { declared });
  // A user style of any other name, declaring `declared`
  const localStyle = (home: string, name: string, declared: number) => {
    put(join(home, `output-styles/${name}.md`), `---\nname: ${name}\nmaws-to-human-contract: ${declared}\n---\nbody\n`);
    put(join(home, 'settings.json'), { outputStyle: name });
  };
  const init = (outputStyle: string | null, seq: number | null = 1) =>
    ({ id: `e${seq}`, sessionId: ENGINE_ID, at: AT, seq, agentId: null, parentToolUseId: null, kind: 'session.init', outputStyle }) as unknown as SessionEvent;

  it('a new session under the plugin’s style appends supplement 3, advertises 8, and records unrecorded → the supplemented source', async () => {
    style(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec({ extraSettings: { env: { CUA_BROWSER_BACKENDS: '/sock' } } }), { kind: 'new', transcriptOf: null });
    expect(decided.appendSystemPrompt).toBe(TO_HUMAN_SUPPLEMENT);
    expect(decided.appendSystemPrompt).not.toContain(CONTRACT_HEADER(0).slice(0, -3)); // no contract of MAWS's, of any version
    expect(decided.systemPromptSnapshot ?? null).toBeNull();
    expect(decided.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/sock', [NATIVE_TO_HUMAN_ENV]: ADVERTISED } }); // no SessionStart hook any more
    expect(decision).toMatchObject({ appSessionId: record, laneOn: true, desired: 'external-style-plus-supplement', recorded: 'unrecorded', appended: true, snapshotOff: false, applied: 'external-style-plus-supplement', style: PLUGIN_STYLE });
    expect(binaryCalls).toBe(0); // "off" was never wanted
    launches.launched(decision!, { launchId: 'l1', at: AT });
    expect(index.ownerChannel.session(record)).toMatchObject({ launchId: 'l1', launchedAt: AT, enabledAt: AT, desired: 'external-style-plus-supplement', recorded: 'unrecorded', appended: true, snapshotOff: false, applied: 'external-style-plus-supplement', style: PLUGIN_STYLE });
  });

  // No to-human plugin's tool, no to-human lane: the switch stays on (its watermark set), the launch wants nothing
  it.each([
    ['no style (the default)', () => {}, {}],
    ['the plugin’s style declaring 2, marks', () => style(configHome, 2), {}],
    ['the plugin’s style declaring 4, before its tool', () => style(configHome, 4), {}],
    ['the plugin’s style declaring 5', () => style(configHome, 5), {}],
    ['the plugin’s style with the to-human plugin off', () => installToHumanPlugin(configHome, { toHuman: false }), {}],
    ['the plugin’s style with the launch profile’s plugin off', () => style(configHome), { enabledPlugins: { 'to-human@doperpowers': false } }],
    ['the plugin’s style under the launch profile’s hooks none', () => style(configHome), { disableAllHooks: true }],
    ['a user style of another name declaring 6', () => localStyle(configHome, 'report', 6), {}],
  ] as const)('a new session under %s runs with the lane off: nothing appended, no variable', async (_, select, profile) => {
    select();
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec({ extraSettings: { ...profile, env: { CUA_BROWSER_BACKENDS: '/sock' } } }), { kind: 'new', transcriptOf: null });
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decided.extraSettings).toEqual({ ...profile, env: { CUA_BROWSER_BACKENDS: '/sock' } });
    expect(decision).toMatchObject({ laneOn: true, desired: 'off', recorded: 'unrecorded', appended: false, snapshotOff: false, applied: 'off' });
    launches.launched(decision!, { launchId: 'l1', at: AT });
    expect(index.ownerChannel.session(record)).toMatchObject({ enabledAt: AT, desired: 'off', applied: 'off' });
  });

  // P4-R7z: a session MAWS gave an earlier contract, supplement or P4-R7y's alias renders anew at its next launch, once
  it.each([
    ['contract 7', LEGACY_CONTRACT_7.text, 'contract:7'],
    ['contract 5', LEGACY_CONTRACT_5.text, 'contract:5'],
    ['contract 1', LEGACY_CONTRACT_1.text, 'contract:1'],
    ['supplement 2', LEGACY_SUPPLEMENT_2.text, 'supplement:2'],
    ['supplement 1', LEGACY_SUPPLEMENT_1.text, 'supplement:1'],
    ['P4-R7y’s alias', LEGACY_MESSAGE_TOOL_ALIAS, 'alias'],
  ] as const)('a session recorded under %s, now under the plugin’s style: supplement 3 appended and "off" passed, once', async (_, text, recorded) => {
    transcript(configHome, text);
    style(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off', extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: '8' } } });
    expect(decision).toMatchObject({ desired: 'external-style-plus-supplement', recorded, snapshotOff: true, applied: 'external-style-plus-supplement' });
    recordSnapshot(configHome, TO_HUMAN_SUPPLEMENT);
    expect((await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record })).record).toMatchObject({ recorded: SUPP, snapshotOff: false });
    expect(binaryCalls).toBe(1); // asked once, for the launch that wanted "off"
  });

  it('a session recorded under contract 7 with no plugin style: "off" passed, nothing appended, the lane off', async () => {
    transcript(configHome, LEGACY_CONTRACT_7.text);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ systemPromptSnapshot: 'off', extraSettings: null });
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decision).toMatchObject({ laneOn: true, desired: 'off', recorded: 'contract:7', appended: false, snapshotOff: true, applied: 'off' });
  });

  it('a style moving back from 6 to 4 drops the recorded supplement with the lane; a key bump keeping the shape changes nothing', async () => {
    transcript(configHome, `${SUPPLEMENT_HEADER(TO_HUMAN_SUPPLEMENT_VERSION)}\n\nthe supplement`);
    style(configHome, 4);
    const four = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(four.spec.appendSystemPrompt ?? null).toBeNull();
    expect(four.record).toMatchObject({ desired: 'off', recorded: SUPP, snapshotOff: true, applied: 'off' });
    style(configHome, 9);
    const later = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(later.spec.appendSystemPrompt).toBe(TO_HUMAN_SUPPLEMENT);
    expect(later.record).toMatchObject({ desired: 'external-style-plus-supplement', recorded: SUPP, snapshotOff: false });
  });

  it('a resume with the override off over a recorded supplement passes "off", no append and no variable', async () => {
    transcript(configHome, TO_HUMAN_SUPPLEMENT);
    style(configHome);
    index.ownerChannel.setOverride(record, 'off');
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ systemPromptSnapshot: 'off', extraSettings: null });
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decision).toMatchObject({ laneOn: false, override: 'off', desired: 'off', recorded: SUPP, appended: false, snapshotOff: true, applied: 'off' });
    launches.launched(decision!, { launchId: 'l2', at: AT });
    expect(index.ownerChannel.session(record)).toMatchObject({ enabledAt: null, applied: 'off', snapshotOff: true });
  });

  it('turned on again over a session that recorded none: the append, the flag and the variable', async () => {
    transcript(configHome, null);
    style(configHome);
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off', extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED } } });
    expect(decision).toMatchObject({ recorded: 'none', snapshotOff: true, applied: 'external-style-plus-supplement' });
  });

  it('a binary without the flag: no "off", applied stays the snapshot’s, and the decision says the change waits', async () => {
    style(configHome);
    for (const answer of [false, undefined]) {
      declares = answer;
      transcript(configHome, null);
      const { spec: decided, record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(decided.systemPromptSnapshot ?? null).toBeNull();
      expect(decided.appendSystemPrompt).toBe(TO_HUMAN_SUPPLEMENT);
      expect(decision).toMatchObject({ snapshotOff: false, offUnavailable: true, applied: 'external-compatible-style' });
      launches.launched(decision!, { launchId: 'l1', at: AT });
      expect(index.ownerChannel.session(record)).toMatchObject({ snapshotOff: false, offUnavailable: true, applied: 'external-compatible-style' });
    }
  });

  it('a fork reads its parent’s transcript', async () => {
    transcript(configHome, `${CONTRACT_HEADER(5)}\n\nan older contract`);
    style(configHome);
    const child = index.sessions.upsertFromSummary(summary({ directory: work })).record.appId;
    const forked = spec({ appSessionId: child, resume: { sessionId: ENGINE_ID, fork: true }, inheritGrantsFrom: record });
    const { record: decision } = await ownerChannelLaunch(s, forked, { kind: 'fork', transcriptOf: record });
    expect(decision).toMatchObject({ appSessionId: child, recorded: 'contract:5', appended: true, snapshotOff: true });
  });

  it('reads the config home of the engine’s environment (s.env), never main’s process.env', async () => {
    const mainHome = join(root, 'main-config');
    vi.stubEnv('CLAUDE_CONFIG_DIR', mainHome);
    style(mainHome); // a style only main's own environment would find
    transcript(mainHome, TO_HUMAN_SUPPLEMENT);
    transcript(configHome, null); // the engine's home: nothing recorded
    const { record: decision } = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
    expect(decision).toMatchObject({ desired: 'off', recorded: 'none', style: 'default' });
  });

  it('the app switch off, and no override: the lane is off and nothing is appended', async () => {
    style(configHome);
    appEnabled = false;
    const { spec: decided, record: decision } = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
    expect(decided.extraSettings).toBeNull();
    expect(decided.appendSystemPrompt ?? null).toBeNull();
    expect(decision).toMatchObject({ laneOn: false, desired: 'off', applied: 'off' });
    index.ownerChannel.setOverride(record, 'on');
    expect((await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null })).record).toMatchObject({ laneOn: true, override: 'on', desired: 'external-style-plus-supplement' });
  });

  // P4-R7z: the advertisement goes exactly where the lane carries the plugin's tool; no launch carries a hook of MAWS's
  it('every launch kind advertises 8 while the lane is on under the plugin’s style, and not while it is off or under another style; none carries a hook', async () => {
    transcript(configHome, TO_HUMAN_SUPPLEMENT);
    const child = index.sessions.upsertFromSummary(summary({ directory: work })).record.appId;
    const kinds = [
      { kind: 'new' as const, spec: spec(), transcriptOf: null },
      { kind: 'fork' as const, spec: spec({ appSessionId: child, resume: { sessionId: ENGINE_ID, fork: true }, inheritGrantsFrom: record }), transcriptOf: record },
      { kind: 'resume' as const, spec: resumeSpec(), transcriptOf: record },
    ];
    for (const [on, declared] of [[true, 6], [false, 6], [true, 4]] as const) {
      appEnabled = on;
      style(configHome, declared);
      for (const { kind, spec: given, transcriptOf } of kinds) {
        const { spec: decided, record: decision } = await ownerChannelLaunch(s, given, { kind, transcriptOf });
        const carried = on && declared === 6;
        expect(decision, `${kind}, lane ${on ? 'on' : 'off'}, style ${declared}`).toMatchObject({ kind, laneOn: on, desired: carried ? 'external-style-plus-supplement' : 'off' });
        const settings = decided.extraSettings as { env?: Record<string, string>; hooks?: unknown } | null;
        expect(settings?.hooks ?? null).toBeNull();
        expect(settings?.env?.[NATIVE_TO_HUMAN_ENV] ?? null).toBe(carried ? ADVERTISED : null);
        expect(LaunchSpecSchema.parse(decided)).toEqual(decided);
      }
    }
  });

  // P4-R7z: under the launch profile's hooks `none` the plugin's hooks do not load, so its tool is not registered: a
  // session that recorded the supplement drops it, and the profile's own settings pass as they are
  it('under hooks none the lane is off: nothing appended, the profile’s settings kept, a recorded supplement dropped', async () => {
    style(configHome);
    const hooksNone = { extraSettings: { disableAllHooks: true, hooks: { Stop: [{ hooks: [] }] } } };
    const fresh = await ownerChannelLaunch(s, spec(hooksNone), { kind: 'new', transcriptOf: null });
    expect(fresh.spec.appendSystemPrompt ?? null).toBeNull();
    expect(fresh.spec.extraSettings).toEqual({ disableAllHooks: true, hooks: { Stop: [{ hooks: [] }] } });
    expect(fresh.record).toMatchObject({ laneOn: true, desired: 'off' });
    transcript(configHome, TO_HUMAN_SUPPLEMENT);
    const resumed = await ownerChannelLaunch(s, resumeSpec(hooksNone), { kind: 'resume', transcriptOf: record });
    expect(resumed.spec.systemPromptSnapshot).toBe('off');
    expect(resumed.record).toMatchObject({ desired: 'off', recorded: SUPP, snapshotOff: true, applied: 'off' });
  });

  it('without the owner channel (no index), the spec goes unchanged and nothing is recorded', async () => {
    const plain = spec();
    expect(await ownerChannelLaunch({ ...s, owner: null }, plain, { kind: 'new', transcriptOf: null })).toEqual({ spec: plain, record: null });
  });

  describe('the mismatch check (Design §2)', () => {
    it('records the engine’s style at the decided launch’s first live init, and decides the next launch by it', async () => {
      style(configHome); // the resolver reads the plugin's style
      const first = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
      expect(first.record).toMatchObject({ style: PLUGIN_STYLE, decidedBy: PLUGIN_STYLE, desired: 'external-style-plus-supplement' });
      launches.launched(first.record!, { launchId: 'l1', at: AT });
      launches.observe(record, [init('default', null)]); // a backfill's init is no observation
      expect(index.ownerChannel.session(record)).toMatchObject({ observedStyle: null, styleMismatch: false });
      launches.observe(record, [init(null)]); // null reads as the default
      expect(index.ownerChannel.session(record)).toMatchObject({ style: PLUGIN_STYLE, observedStyle: 'default', styleMismatch: true });
      launches.observe(record, [init(PLUGIN_STYLE, 2)]); // only the first init after the launch counts
      expect(index.ownerChannel.session(record)).toMatchObject({ observedStyle: 'default', styleMismatch: true });

      // the settings still read the plugin's style: the next decision goes by the engine's "default", the resolver's kept
      const second = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(second.record).toMatchObject({ style: PLUGIN_STYLE, decidedBy: 'default', desired: 'off', appended: false });
    });

    it('a persistent misreading keeps deciding by the engine’s name, launch after launch, without alternating', async () => {
      style(configHome); // the resolver reads the plugin's style; the engine keeps reporting the default
      const first = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
      expect(first.record).toMatchObject({ style: PLUGIN_STYLE, desired: 'external-style-plus-supplement', appended: true });
      launches.launched(first.record!, { launchId: 'l1', at: AT });
      launches.observe(record, [init('default', 1)]);

      transcript(configHome, TO_HUMAN_SUPPLEMENT); // launch 1 recorded the supplement
      for (const [n, recorded] of [[2, SUPP], [3, 'none'], [4, 'none']] as const) {
        const next = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
        // decided by the engine's "default" each time: the lane is off, the supplement switched off once and never again
        expect(next.record).toMatchObject({ style: PLUGIN_STYLE, decidedBy: 'default', desired: 'off', recorded, appended: false, snapshotOff: recorded === SUPP, applied: 'off' });
        launches.launched(next.record!, { launchId: `l${n}`, at: AT });
        launches.observe(record, [init('default', n)]); // the engine agrees with the name the launch decided by, never with the resolver
        expect(index.ownerChannel.session(record)).toMatchObject({ style: PLUGIN_STYLE, observedStyle: 'default', styleMismatch: true });
        if (recorded === SUPP) recordSnapshot(configHome, null); // the session renders anew and records no text of MAWS's
      }
    });

    it('a settings change the engine then reports alike clears the mismatch, and the settings decide again', async () => {
      localStyle(configHome, 'brief', 1); // the resolver reads "brief", which carries no lane
      const first = await ownerChannelLaunch(s, spec(), { kind: 'new', transcriptOf: null });
      expect(first.record).toMatchObject({ style: 'brief', desired: 'off' });
      launches.launched(first.record!, { launchId: 'l1', at: AT });
      launches.observe(record, [init('default', 1)]);
      transcript(configHome, null);

      // the owner selects the plugin's style, and the engine reads it as the resolver does
      style(configHome);
      const second = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(second.record).toMatchObject({ style: PLUGIN_STYLE, decidedBy: 'default', desired: 'off' }); // agreement not yet observed
      launches.launched(second.record!, { launchId: 'l2', at: AT });
      launches.observe(record, [init(PLUGIN_STYLE, 2)]);
      expect(index.ownerChannel.session(record)).toMatchObject({ style: PLUGIN_STYLE, observedStyle: PLUGIN_STYLE, styleMismatch: false });

      const third = await ownerChannelLaunch(s, resumeSpec(), { kind: 'resume', transcriptOf: record });
      expect(third.record).toMatchObject({
        style: PLUGIN_STYLE, decidedBy: PLUGIN_STYLE, desired: 'external-style-plus-supplement', recorded: 'none', snapshotOff: true, applied: 'external-style-plus-supplement',
      });
    });

    it('ignores an init for a session with no decided launch awaiting one', () => {
      launches.observe(record, [init('Explanatory')]);
      expect(index.ownerChannel.session(record)).toBeNull();
    });
  });
});
