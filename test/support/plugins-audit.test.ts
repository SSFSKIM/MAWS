// The live run's G4 audit (E8 execution document, M3; D-12): what a CLI action may change under the config home and the
// project, and what it may not. A mutation may write its `writesOf` manifest; any action (a listing too) may touch the
// engine's catalogue caches and its `.claude.json` bookkeeping; the running session's own files are recognised by name;
// a configuration write outside the manifest fails the verdict, and a path nobody recognises is reported, not exempted.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditOf, claudeJsonChanges, manifestOf, pathKind, readTree, type Tree } from './plugins-audit';

const tree = (files: Record<string, string>, claudeJson: Record<string, unknown> | null = null): Tree => ({ files, claudeJson });
const listing = null;

describe('the plugins audit', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('accepts the engine’s .claude.json bookkeeping and rejects a configuration key changing there', () => {
    const before = { theme: 'light', projects: { '/tmp/r': { hasTrustDialogAccepted: true } }, pluginUsage: {} };
    const usage = { ...before, pluginUsage: { 'e8-probe@e8-scratch': { usageCount: 1 } }, machineID: 'm', migrationVersion: 14, opusProMigrationComplete: true, seenNotifications: {}, cachedGrowthBookFeatures: {} };
    expect(claudeJsonChanges(before, usage).map((c) => c.kind)).toEqual(Array(6).fill('records (D-12)'));
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
    expect(first.claudeJson).toEqual({ theme: 'light' });
    writeFileSync(join(config, 'settings.json'), '{}\n'); // the same bytes, written again
    utimesSync(join(config, 'settings.json'), 2_000, 2_000);
    expect(auditOf(first, readTree(config, join(root, 'project')), listing).unannounced).toEqual(['changed config/settings.json']);
  });
});
