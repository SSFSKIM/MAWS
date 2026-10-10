// The widgets' pure `present` functions over the probe's recorded answers (C11 execution document, M2 pins): each is
// driven with the JSON of the cited fixture line, so what a widget shows is pinned apart from how it renders.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type {
  ExportConversationResponse,
  GetContextUsageResponse,
  GetHooksListingResponse,
  GetMemoryDialogResponse,
  GetSandboxDialogResponse,
  GetSettingsResponse,
  GetStatusResponse,
  GetUsageResponse,
  GetWorkspaceDiffResponse,
  ListPermissionRulesResponse,
  McpStatusResponse,
} from '@shared/wire/control';
import { fixtureLine } from '../../../../test/support/widget-backend';
import { projectCatalog } from '../stores/catalog';
import * as Agents from './AgentsWidget';
import * as Config from './ConfigWidget';
import * as Context from './ContextWidget';
import * as Diff from './DiffWidget';
import * as Export from './ExportWidget';
import * as Hooks from './HooksWidget';
import * as Mcp from './McpWidget';
import * as Memory from './MemoryWidget';
import * as Permissions from './PermissionsWidget';
import * as Plugins from './plugins/LoadedView';
import * as Sandbox from './SandboxWidget';
import { skillGroups } from './skills/skills';
import * as Status from './StatusWidget';
import * as Usage from './UsageWidget';

const ROOT = join(__dirname, '../../../..');
// The payload of a journal's row, named by journal and seq.
const line = <T>(journal: string, seq: number) => fixtureLine(ROOT, `${journal}#${seq}`) as T;

describe('every widget renders its fixture response', () => {
  it('context: the line with the autocompact threshold, six categories with Free space last, and the costs', () => {
    const view = Context.present(line<GetContextUsageResponse>('reads', 57));
    expect(view.line).toBe('30,433 of 200,000 · 15% · autocompact at 167,000');
    expect(view.categories.map((c) => c.name)).toEqual(['System prompt', 'System tools', 'System tools (deferred)', 'Skills', 'Messages', 'Free space']);
    expect(view.categories[2]).toEqual({ name: 'System tools (deferred)', tokens: '28,272', note: 'not in the window' });
    expect(view.used.map((u) => u.name)).toEqual(['System prompt', 'System tools', 'Skills', 'Messages']);
    expect(view.thresholdShare).toBeCloseTo(83.5);
    expect(view.costs).toEqual([
      { label: 'Memory files', value: 'none' },
      { label: 'MCP tools', value: 'none' },
      { label: 'Agents', value: 'none' },
      { label: 'Commands', value: '13 of 13 · 1,403 tokens' },
      { label: 'Skills', value: '13 of 13 · 1,435 tokens' },
    ]);
  });

  it('permissions: a session grant and a startup-settings ask rule with their sources and editability', () => {
    const view = Permissions.present(line<ListPermissionRulesResponse>('pass2/grant-askrule-start', 65).state, null);
    expect(view.groups.map((g) => [g.label, g.rules.length])).toEqual([
      ['Allow', 1],
      ['Ask', 1],
      ['Deny', 0],
    ]);
    expect(view.groups[0].rules[0]).toEqual({ rule: 'Bash(git log --oneline)', source: 'this session · grant', editability: 'session', description: { prefix: 'The Bash command ', emphasis: 'git log --oneline' } });
    expect(view.groups[1].rules[0]).toMatchObject({ rule: 'Bash(git:*)', source: 'startup settings', editability: 'readonly' });
    expect(view.workspace).toEqual([{ path: '/private/tmp/maws-probe2-UVKiUq', note: 'original directory' }]);
    expect(view.mode).toBeNull();
  });

  it('permissions: an empty state, an unknown source verbatim, and the effective mode with its refusal in words', () => {
    const empty = Permissions.present(line<ListPermissionRulesResponse>('reads', 63).state, null);
    expect(empty.groups.every((g) => g.rules.length === 0)).toBe(true);
    const odd = Permissions.present({ rules: [{ behavior: 'deny', source: 'someNewSource', rule: 'Read(.env)' }], workspaceDirectories: ['/w'], originalCwd: '/o', managedOnly: true }, {
      permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' },
      grants: ['Bash(ls)'],
    } as Pick<EngineSessionStatus, 'permissionMode' | 'grants'>);
    expect(odd.groups[2].rules[0]).toMatchObject({ source: 'someNewSource', editability: null, description: null });
    expect(odd.workspace).toEqual([
      { path: '/o', note: 'original directory' },
      { path: '/w', note: 'added' },
    ]);
    expect(odd.mode).toEqual({ effective: 'default', refusal: 'This model does not support auto mode' });
    expect(odd.managedOnly).toBe(true);
    expect(odd.grants).toBe(1);
  });

  it('hooks: one PostToolUse hook from startup settings with its matcher and display text', () => {
    const view = Hooks.present(line<GetHooksListingResponse>('pass2/hooks', 46));
    expect(view.events).toEqual([{ name: 'PostToolUse', summary: 'After tool execution', count: 1 }]);
    expect(view.hooks).toEqual([{ event: 'PostToolUse', matcher: 'Bash', source: 'Startup settings (--settings option)', text: 'echo MAWS_POSTHOOK', type: 'command' }]);
    expect(view.policy).toBeNull();
    expect(Hooks.present(line<GetHooksListingResponse>('reads', 66)).hooks).toEqual([]);
  });

  it('memory: the user and project files with existence, the auto-memory folder and state', () => {
    const view = Memory.present(line<GetMemoryDialogResponse>('reads', 69));
    expect(view.files.map((f) => [f.label, f.exists, f.note])).toEqual([
      ['User instructions', true, null],
      ['Project instructions', false, 'does not exist yet'],
    ]);
    expect(view.files[1].path).toBe('/private/tmp/maws-probe-35ZnCO/CLAUDE.md');
    expect(view.folders).toEqual([{ label: 'Open auto-memory folder', path: '/Users/new/.claude/projects/-private-tmp-maws-probe-35ZnCO/memory/' }]);
    expect(view.autoMemory).toBe('on');
  });

  // E11's sitting (owner-notes 00-consolidated-plan §2.2): the first read is on or off with why, the wire's fields under
  // a disclosure.
  it('sandbox: Sandbox off and why, with its settings and empty restrictions as details', () => {
    const view = Sandbox.present(line<GetSandboxDialogResponse>('reads', 75));
    expect(view.headline).toBe('Sandbox off');
    expect(view.reason).toBe('Not turned on in your settings');
    expect(view.locked).toBe(false);
    expect(view.rows).toContainEqual({ label: 'In your settings', value: 'off' });
    expect(view.rows).toContainEqual({ label: 'Unsandboxed fallback', value: 'allowed' });
    expect(view.restrictions).toEqual([]);
    expect(view.dependencies).toEqual({ errors: [], warnings: [] });
  });

  it('sandbox: on says what happens to a command it cannot run; off says it is unsupported or unavailable, and a policy lock', () => {
    const base = line<GetSandboxDialogResponse>('reads', 75);
    expect(Sandbox.present({ ...base, enabled: true, enabled_in_settings: true, mode: 'auto-allow', unsandboxed_fallback: true })).toMatchObject({ headline: 'Sandbox on', reason: 'A command that fails in the sandbox may run outside it, with your permission' });
    expect(Sandbox.present({ ...base, enabled: true, enabled_in_settings: true, unsandboxed_fallback: false, locked: true })).toMatchObject({ headline: 'Sandbox on', reason: 'Commands run only inside the sandbox', locked: true });
    expect(Sandbox.present({ ...base, supported: false, unsupported_reason: 'sandbox-exec is missing' }).reason).toBe('Not supported on this Mac: sandbox-exec is missing');
    expect(Sandbox.present({ ...base, enabled_in_settings: true, unavailable_reason: 'dependencies are missing' }).reason).toBe('Turned on in your settings but unavailable: dependencies are missing');
    expect(Sandbox.present({ ...base, enabled_in_settings: true }).reason).toBe('Turned on in your settings but not in effect');
  });

  // F2a review 1: the engine runs excluded commands outside the sandbox whatever the fallback says, so with any excluded
  // the first read names them and the refused fallback speaks only of the other commands.
  it('sandbox: on with excluded commands names them in the first read, and the refused fallback covers only the rest', () => {
    const base = line<GetSandboxDialogResponse>('reads', 75);
    const on = { ...base, enabled: true, enabled_in_settings: true };
    expect(Sandbox.present({ ...on, unsandboxed_fallback: false })).toMatchObject({ reason: 'Commands run only inside the sandbox', outside: null });
    expect(Sandbox.present({ ...on, unsandboxed_fallback: false, excluded_commands: ['docker', 'npm'] })).toMatchObject({
      reason: 'Other commands run only inside the sandbox',
      outside: 'Runs outside it: docker, npm',
      excluded: ['docker', 'npm'],
    });
    expect(Sandbox.present({ ...on, unsandboxed_fallback: true, excluded_commands: ['docker', 'npm', 'git', 'make', 'kubectl'] })).toMatchObject({
      reason: 'A command that fails in the sandbox may run outside it, with your permission',
      outside: 'Runs outside it: docker, npm, git and 2 more',
    });
    expect(Sandbox.present({ ...base, excluded_commands: ['docker'] }).outside, 'off: every command already runs outside it').toBeNull();
  });

  it('diff: 0 files on the working tree; a null diff says why', () => {
    expect(Diff.present(line<GetWorkspaceDiffResponse>('reads', 81))).toEqual({ line: '0 files · +0 −0 · working tree', files: [], skippedLarge: 0, restricted: 0, scope: 'uncommitted' });
    expect(Diff.present({ diff: null }).line).toBe('No diff · not a git repository, or a merge, rebase or cherry-pick is in progress');
    const one = Diff.present({
      diff: {
        stats: { filesCount: 2, linesAdded: 3, linesRemoved: 1 },
        perFileStats: [
          { path: 'a.ts', added: 3, removed: 1, isBinary: false, isUntracked: false },
          { path: 'b.png', added: 0, removed: 0, isBinary: true, isUntracked: true },
        ],
        hunks: [],
        skippedLarge: ['big.bin'],
        restricted: [],
        source: { kind: 'branch', baseBranch: 'main', baseRef: 'abc' },
      },
    });
    expect(one.line).toBe('2 files · +3 −1 · against main');
    expect(one.files).toEqual([
      { path: 'a.ts', stat: '+3 −1', note: null },
      { path: 'b.png', stat: '', note: 'binary · untracked' },
    ]);
    expect(one.skippedLarge).toBe(1);
  });

  it('export: the default filename and the first line of the text', () => {
    const view = Export.present(line<ExportConversationResponse>('reads', 84));
    expect(view.filename).toBe('2026-09-28-022217-reply-with-exactly-ok.txt');
    expect(view.firstLine).toBe('❯ Reply with exactly OK');
  });

  it('mcp: three servers with transports, tools as a count, stdio commands shortened', () => {
    const view = Mcp.present(line<McpStatusResponse>('pass2/real-settings', 63));
    expect(view.servers.map((s) => [s.name, s.status, s.transport, s.tools.length])).toEqual([
      ['plugin:ptc:ptc', 'connected', 'stdio · …/ptc-launch', 6],
      ['plugin:chatgpt-advisor:advisor', 'connected', 'stdio · node …/mcp-server.mjs', 3],
      ['openaiDeveloperDocs', 'connected', 'http · https://developers.openai.com/mcp', 5],
    ]);
    expect(view.servers[2]).toMatchObject({ scope: 'user', source: 'user', error: null });
    expect(view.servers[0].command).toBe('/Users/new/.claude/plugins/cache/ptc-tool/ptc/0.5.0/bin/ptc-launch');
  });

  it('plugins: the eleven loaded plugins with their versions', () => {
    const init = line<{ plugins: { name: string; path: string; source: string; version?: string }[] }>('pass2/real-settings', 15);
    const plugins = init.plugins.map((p) => ({ name: p.name, path: p.path, source: p.source, version: p.version ?? null }));
    const view = Plugins.present({ plugins, errors: [], warnings: [] });
    expect(view.plugins).toHaveLength(11);
    expect(view.plugins[0]).toEqual({ name: 'designer', version: '2.1.0', source: 'designer@designer', path: '/Users/new/.claude/plugins/cache/designer/designer/2.1.0' });
    expect(view.plugins[8]).toMatchObject({ name: 'agents-md', version: null, path: 'builtin' });
    const failing = Plugins.present({ plugins: [], errors: [{ plugin: 'x', type: 'load', message: 'bad manifest', path: null }], warnings: [{ plugin: 'y', type: 'deprecated', message: 'old' }] });
    expect(failing.problems).toEqual([
      { plugin: 'x', level: 'error', text: 'load · bad manifest' },
      { plugin: 'y', level: 'warning', text: 'deprecated · old' },
    ]);
  });

  it('status: every section and row verbatim, labels in the key column', () => {
    const view = Status.present(line<GetStatusResponse>('pass2/auto-routed', 145));
    expect(view.sections.map((s) => s.title)).toEqual(['Session', 'Environment']);
    expect(view.sections[0].rows).toContainEqual({ label: 'Anthropic base URL', value: 'http://127.0.0.1:8641' });
    expect(view.sections[1].rows).toContainEqual({ label: 'Auto mode server', value: 'Enabled' });
    expect(Status.present({ sections: [{ title: 'Internal', rows: [{ value: 'unlabeled' }] }] }).sections[0].rows).toEqual([{ label: null, value: 'unlabeled' }]);
  });

  it("skills: an empty dialog falls back to the catalogue's eighteen skills, with their descriptions", () => {
    const initialize = line<{ commands: unknown[]; agents: unknown[] }>('pass2/auto-routed', 4);
    const init = line<{ skills: unknown[]; terminal_slash_commands: unknown[] }>('pass2/auto-routed', 9);
    const catalog = projectCatalog('l1', { commands: initialize.commands, agents: initialize.agents, skills: init.skills, terminalSlashCommands: init.terminal_slash_commands, revision: 1 });
    // P2-B M6: the skills library's model (`skills/skills.ts`), the catalogue's skills in one list
    const [view] = skillGroups(line<{ skills: unknown[] }>('reads', 72), catalog, [], []);
    expect(view.group).toBeNull();
    expect(view.rows).toHaveLength(18);
    const research = view.rows.find((r) => r.name === 'deep-research')!;
    expect(research.description).toMatch(/^Deep research harness/);
    expect(skillGroups({ skills: [{ name: 'mine', description: 'My skill', source: 'user' }, { bogus: true }] }, catalog, [], [])).toEqual([{ group: 'yours', rows: [{ name: 'mine', plugin: null, description: 'My skill', source: 'user' }] }]);

    const agents = Agents.present(catalog); // the initialize response's five agents (seq 4), in its order
    expect(agents.map((a) => a.name)).toEqual(['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup']);
    expect(agents[1].description).toMatch(/^Fast read-only search agent for locating code/);
  });

  it("usage: the engine's session accounting, and no windows reported through the relay", () => {
    const view = Usage.present(line<GetUsageResponse>('reads', 54));
    expect(view.rows).toEqual([
      { label: 'Cost', value: '$0.0208' },
      { label: 'API time', value: '1.7 s' },
      { label: 'Wall time', value: '1.5 s' },
      { label: 'Lines', value: '+0 −0' },
    ]);
    expect(view.models).toEqual([{ model: 'claude-haiku-4-5-20251001', line: '906 in · 56 out · 12,318 cache read · 9,179 cache write' }]);
    expect(view.engineWindows).toEqual({ fact: 'rate_limits_available: false', sentence: 'the engine reports no windows through the relay' });
  });

  // C11 M6, live: a session switched to Direct under a login the engine reports no limits for reads the same answer, and
  // the sentence names the login, not the relay.
  it('usage on a direct session: no windows reported is said of the login', () => {
    const view = Usage.present(line<GetUsageResponse>('reads', 54), 'direct');
    expect(view.engineWindows).toEqual({ fact: 'rate_limits_available: false', sentence: 'the engine reports no windows for this login' });
  });

  it('config: the effective settings, their sources and what was applied', () => {
    const view = Config.present(line<GetSettingsResponse>('pass2/dialogs', 58));
    expect(view.effective).toEqual([{ key: 'dialogExpiry', value: '"never"' }]);
    expect(view.sources).toEqual([{ source: 'flagSettings', label: 'startup settings', keys: ['dialogExpiry'] }]);
    expect(view.applied).toEqual([
      { label: 'Model', value: 'claude-sonnet-5[1m]' },
      { label: 'Effort', value: 'high' },
      { label: 'Advisor', value: 'none' },
      { label: 'Ultracode', value: 'off' },
    ]);
    expect(Config.present(line<GetSettingsResponse>('reads', 60)).effective).toEqual([]);
  });
});
