// The live run's G4 audit (E8 execution document, M3; D-12): what a CLI action may change under the config home and the
// project, and what it may not. A mutation may write its `writesOf` manifest; any action (a listing too) may touch the
// engine's catalogue caches and its `.claude.json` bookkeeping; the running session's own files are recognised by name;
// a configuration write outside the manifest fails the verdict, and a path nobody recognises is reported, not exempted.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditOf, bridgeTimedOut, claudeJsonChanges, manifestOf, pathKind, readTree, untilQuiet, type ClaudeJson, type SettledInvoke, type Tree } from './plugins-audit';

const obj = (value: Record<string, unknown>): ClaudeJson => ({ state: 'object', value });
const tree = (files: Record<string, string>, claudeJson: Record<string, unknown> | ClaudeJson | null = null): Tree => ({
  files,
  claudeJson: claudeJson === null ? { state: 'absent' } : 'state' in claudeJson && typeof claudeJson.state === 'string' ? (claudeJson as ClaudeJson) : obj(claudeJson as Record<string, unknown>),
});
const listing = null;

describe('the plugins audit', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('accepts the engine’s .claude.json bookkeeping and rejects a configuration key changing there', () => {
    const before = { theme: 'light', projects: { '/tmp/r': { hasTrustDialogAccepted: true } }, pluginUsage: {} };
    const usage = { ...before, pluginUsage: { 'e8-probe@e8-scratch': { usageCount: 1 } }, machineID: 'm', migrationVersion: 14, opusProMigrationComplete: true, seenNotifications: {}, cachedGrowthBookFeatures: {} };
    expect(claudeJsonChanges(obj(before), obj(usage)).map((c) => c.kind)).toEqual(Array(6).fill('records (D-12)'));
    const files = { 'config/.claude.json': '1' };
    const accepted = auditOf(tree(files, before), tree({ 'config/.claude.json': '2' }, usage), listing);
    expect(accepted.unannounced).toEqual([]);
    expect(accepted.unclassified).toEqual([]);

    for (const key of ['projects', 'mcpServers', 'enabledMcpjsonServers', 'permissions']) {
      const after = { ...before, [key]: key === 'projects' ? { '/tmp/r': { hasTrustDialogAccepted: true, allowedTools: ['Bash'] } } : { changed: true } };
      const rejected = auditOf(tree(files, before), tree({ 'config/.claude.json': '2' }, after), listing);
      expect(rejected.unannounced, key).toEqual([`changed config/.claude.json · ${key}`]);
    }
  });

  it('lets a listing touch only the catalogue caches, backups and session files; a settings or registry change fails it', () => {
    const before = tree({ 'config/settings.json': 'a', 'config/plugins/known_marketplaces.json': 'a' });
    const caches = tree({ ...before.files, 'config/plugins/plugin-catalog-cache.json': 'c', 'config/plugins/plugin-directory-cache-v2.json': 'c', 'config/backups/.claude.json.backup.1': 'b', 'config/projects/-tmp-r/s.jsonl': 's', 'config/.last-cleanup': 'l' });
    expect(auditOf(before, caches, listing)).toMatchObject({ unannounced: [], unclassified: [] });
    const settings = tree({ ...before.files, 'config/settings.json': 'b' });
    expect(auditOf(before, settings, listing).unannounced).toEqual(['changed config/settings.json']);
    const registry = tree({ ...before.files, 'config/plugins/installed_plugins.json': 'i' });
    expect(auditOf(before, registry, listing).unannounced).toEqual(['added config/plugins/installed_plugins.json']);
    const project = tree({ ...before.files, 'project/.claude/settings.local.json': 'p' });
    expect(auditOf(before, project, listing).unannounced).toEqual(['added project/.claude/settings.local.json']);
  });

  it('lets a mutation write its manifest and nothing else of the configuration', () => {
    const manifest = manifestOf('install', 'user', null, { marketplace: 'e8-scratch', plugin: 'e8-probe', id: 'e8-probe@e8-scratch' });
    const before = tree({ 'config/settings.json': 'a' });
    const after = tree({ 'config/settings.json': 'b', 'config/plugins/installed_plugins.json': 'i', 'config/plugins/cache/e8-scratch/e8-probe/0.1.0/': 'dir' });
    expect(auditOf(before, after, manifest)).toMatchObject({ unannounced: [], unclassified: [] });
    const stray = tree({ ...after.files, 'config/plugins/known_marketplaces.json': 'k' });
    expect(auditOf(before, stray, manifest).unannounced).toEqual(['added config/plugins/known_marketplaces.json']);
  });

  it('lets an install write the cache of a dependency the marketplace declares, in it or in an allowlisted marketplace', () => {
    const manifest = manifestOf('install', 'user', null, { marketplace: 'e8-scratch', plugin: 'e8-probe', id: 'e8-probe@e8-scratch' });
    const before = tree({ 'config/settings.json': 'a' });
    const after = tree({ 'config/settings.json': 'b', 'config/plugins/installed_plugins.json': 'i', 'config/plugins/cache/e8-scratch/e8-probe/0.1.0/': 'dir', 'config/plugins/cache/e8-scratch/e8-base/1.0.0/': 'dir' });
    expect(auditOf(before, after, manifest)).toMatchObject({ unannounced: [], unclassified: [] });
    // a dependency from a marketplace the root one allowlists (allowCrossMarketplaceDependenciesOn) lands in that one's cache
    const crossMarketplace = tree({ ...after.files, 'config/plugins/cache/review-deps/dep/1.0.0/': 'dir' });
    expect(auditOf(before, crossMarketplace, manifest)).toMatchObject({ unannounced: [], unclassified: [] });
    // anything else under plugins/ is still the manifest's to name
    const stray = tree({ ...after.files, 'config/plugins/data/e8-probe@e8-scratch/x': 'd' });
    expect(auditOf(before, stray, manifest).unannounced).toEqual(['added config/plugins/data/e8-probe@e8-scratch/x']);
  });

  it('lets a marketplace removal write what uninstalling its plugins writes: registry, its cache, their data, each scope’s settings', () => {
    const uninstalls = [
      { id: 'e8-probe@e8-scratch', scope: 'user', projectPath: null },
      { id: 'e8-tools@e8-scratch', scope: 'project', projectPath: '/tmp/repo' },
    ];
    const manifest = manifestOf('marketplace-remove', 'user', 'directory', { name: 'e8-scratch' }, uninstalls, '/tmp/repo');
    expect(manifest.paths).toEqual([
      'config/settings.json',
      'config/plugins/known_marketplaces.json',
      'config/plugins/installed_plugins.json',
      'config/plugins/cache/e8-scratch/',
      'config/plugins/data/e8-probe@e8-scratch/',
      'config/plugins/data/e8-tools@e8-scratch/',
      'project/.claude/settings.json',
      'project/.claude/settings.local.json',
    ]);
    // a user-scoped plugin disabled with --scope local in the audited project: the removal clears that override too
    const localOverride = manifestOf('marketplace-remove', 'user', 'directory', { name: 'e8-scratch' }, uninstalls.slice(0, 1), '/tmp/repo');
    const overridden = tree({ 'config/settings.json': 'a', 'project/.claude/settings.local.json': 'disabled' });
    expect(auditOf(overridden, tree({ 'config/settings.json': 'b', 'project/.claude/settings.local.json': '{}' }), localOverride)).toMatchObject({ unannounced: [], unclassified: [] });
    const before = tree({ 'config/settings.json': 'a', 'config/plugins/installed_plugins.json': 'i', 'config/plugins/cache/e8-scratch/e8-probe/0.1.0/': 'dir', 'project/.claude/settings.json': 'p' });
    const after = tree({ 'config/settings.json': 'b', 'config/plugins/installed_plugins.json': 'j', 'project/.claude/settings.json': 'q' });
    expect(auditOf(before, after, manifest)).toMatchObject({ unannounced: [], unclassified: [] });
    // with nothing installed from it, the same delta is unannounced
    expect(auditOf(before, after, manifestOf('marketplace-remove', 'user', 'directory', { name: 'e8-scratch' })).unannounced).toEqual([
      'removed config/plugins/cache/e8-scratch/e8-probe/0.1.0/',
      'changed config/plugins/installed_plugins.json',
      'changed project/.claude/settings.json',
    ]);
  });

  it('reports a path it cannot classify instead of exempting it', () => {
    expect(pathKind('config/agents/new.md')).toBe('unclassified');
    const result = auditOf(tree({}), tree({ 'config/agents/new.md': 'x' }), listing);
    expect(result.unclassified).toEqual(['added config/agents/new.md']);
    expect(result.lines.join('\n')).toContain('[unclassified]');
  });

  it('sees a same-content rewrite through the file’s mtime, and reads .claude.json structured', () => {
    const root = mkdtempSync(join(tmpdir(), 'maws-plugins-audit-'));
    dirs.push(root);
    const config = join(root, 'config');
    mkdirSync(config);
    writeFileSync(join(config, 'settings.json'), '{}\n');
    writeFileSync(join(config, '.claude.json'), JSON.stringify({ theme: 'light' }));
    utimesSync(join(config, 'settings.json'), 1_000, 1_000);
    const first = readTree(config, join(root, 'project'));
    expect(first.claudeJson).toEqual({ state: 'object', value: { theme: 'light' } });
    writeFileSync(join(config, 'settings.json'), '{}\n'); // the same bytes, written again
    utimesSync(join(config, 'settings.json'), 2_000, 2_000);
    expect(auditOf(first, readTree(config, join(root, 'project')), listing).unannounced).toEqual(['changed config/settings.json']);
  });

  it('fails closed on a .claude.json it could not read: malformed before, malformed after, or not a JSON object', () => {
    const files = { 'config/.claude.json': '1' };
    const changed = { 'config/.claude.json': '2' };
    const unreadable: ClaudeJson = { state: 'unreadable', reason: 'Unexpected end of JSON input' };
    const malformedBefore = auditOf(tree(files, unreadable), tree(changed, { theme: 'light' }), listing);
    expect(malformedBefore.unclassified).toEqual(['changed config/.claude.json · its contents before could not be read (Unexpected end of JSON input)']);
    const malformedAfter = auditOf(tree(files, { theme: 'light' }), tree(changed, unreadable), listing);
    expect(malformedAfter.unclassified).toEqual(['changed config/.claude.json · its contents after could not be read (Unexpected end of JSON input)']);
    expect(malformedAfter.lines.join('\n')).toContain('[unclassified]');
    // absent and unreadable are told apart: a file the engine creates is judged by its keys
    expect(auditOf(tree({}), tree(changed, { pluginUsage: {} }), listing)).toMatchObject({ unannounced: [], unclassified: [] });
    expect(auditOf(tree(files, { theme: 'light' }), tree({}), listing).unannounced).toEqual(['removed config/.claude.json · the file was removed']);

    const root = mkdtempSync(join(tmpdir(), 'maws-plugins-audit-'));
    dirs.push(root);
    const config = join(root, 'config');
    mkdirSync(config);
    expect(readTree(config, root).claudeJson).toEqual({ state: 'absent' });
    for (const [text, reason] of [['{"theme": "li', /JSON/], ['[1, 2]', /not a JSON object \(array\)/], ['null', /not a JSON object \(null\)/], ['"light"', /not a JSON object \(string\)/]] as const) {
      writeFileSync(join(config, '.claude.json'), text);
      const read = readTree(config, root).claudeJson; // read twice (the bounded retry), unreadable both times
      expect(read.state, text).toBe('unreadable');
      expect(read.state === 'unreadable' ? read.reason : '', text).toMatch(reason);
    }
  });

  it('closes a window only once no CLI read is in flight and none settled within the quiet period: a delayed read’s write is caught', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maws-plugins-audit-'));
    dirs.push(root);
    const config = join(root, 'config');
    mkdirSync(config);
    writeFileSync(join(config, 'settings.json'), '{}\n');
    // cached data is on screen; its refetch, a CLI read, is still running and writes after a second
    let inflight = 1;
    let lastSettledAt = 0;
    setTimeout(() => writeFileSync(join(config, 'plugins-cache-written-late.json'), '{}'), 1_000);
    setTimeout(() => {
      inflight = 0;
      lastSettledAt = Date.now();
    }, 1_200);
    const before = readTree(config, root);
    const started = Date.now();
    await untilQuiet({ inflight: async () => inflight, lastSettledAt: async () => lastSettledAt, settled: async () => [] }, { quietMs: 300, timeoutMs: 5_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    expect(auditOf(before, readTree(config, root), listing).unclassified).toEqual(['added config/plugins-cache-written-late.json']);
    // a read that never settles is the window's failure, not a silent snapshot
    await expect(untilQuiet({ inflight: async () => 1, lastSettledAt: async () => 0, settled: async () => [] }, { quietMs: 100, timeoutMs: 400 })).rejects.toThrow(/still in flight/);
  });

  it('fails a window on a read the bridge answered timeout, since its CLI may still be writing, naming the command', async () => {
    const at = Date.now() - 2_000;
    const timedOut: SettledInvoke = { name: 'plugins.available', at, ms: 10_002, threw: false, answer: { ok: false, error: { code: 'timeout', message: 'engine-host did not answer plugins.available within 10 s' } } };
    expect(bridgeTimedOut(timedOut)).toBe(true);
    expect(bridgeTimedOut({ ...timedOut, answer: { ok: true, value: { plugins: [] } } })).toBe(false);
    expect(bridgeTimedOut({ ...timedOut, answer: { ok: false, error: { code: 'internal', message: 'no directory' } } })).toBe(false);
    expect(bridgeTimedOut({ ...timedOut, threw: true, answer: null })).toBe(false);
    const tracker = { inflight: async () => 0, lastSettledAt: async () => at, settled: async () => [timedOut] };
    await expect(untilQuiet(tracker, { quietMs: 100, timeoutMs: 1_000 })).rejects.toThrow('plugins.available was answered timeout by the bridge after 10002 ms while its CLI kept running: the audit cannot tell when its writes end');
  });
});
