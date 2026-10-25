// P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M1 Touches): the scratch the Discover e2e
// launch writes for the real engine, on a temporary directory: the engine's Anthropic Directory turned off by its on/off
// file, the scratch projects trusted, the test marketplace copied and described for the catalog's test-source seam, and
// the environment that points the catalog at the recorded sources.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_SERVER_PLACEHOLDER, TEST_MARKETPLACE, writeDiscoverScratch } from '../../e2e/support/discover-scratch';

let userData: string;
let configDir: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-discover-scratch-'));
  configDir = join(userData, 'claude-config');
  mkdirSync(configDir);
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;

describe('the Discover scratch', () => {
  it('turns the engine’s Anthropic Directory off through its on/off file in the plugins folder', () => {
    writeDiscoverScratch(userData, configDir);
    expect(json(join(configDir, 'plugins', 'plugin-directory-marketplace.json'))).toEqual({ enabled: false });
  });

  it('makes one or two scratch projects, real paths the engine’s configuration trusts', () => {
    expect(writeDiscoverScratch(userData, configDir).projects).toHaveLength(1);
    const two = writeDiscoverScratch(mkdtempSync(join(userData, 'again-')), configDir, { projects: 2 }).projects;
    expect(two).toHaveLength(2);
    expect(new Set(two).size).toBe(2);
    const config = json(join(configDir, '.claude.json')) as { hasCompletedOnboarding: boolean; projects: Record<string, { hasTrustDialogAccepted: boolean }> };
    expect(config.hasCompletedOnboarding).toBe(true);
    for (const project of two) {
      expect(realpathSync(project)).toBe(project);
      expect(config.projects[project]!.hasTrustDialogAccepted).toBe(true);
    }
  });

  it('copies the test marketplace and describes it as one added test source', () => {
    const scratch = writeDiscoverScratch(userData, configDir);
    expect(realpathSync(scratch.marketplace)).toBe(scratch.marketplace);
    const manifest = json(join(scratch.marketplace, '.claude-plugin', 'marketplace.json')) as { name: string; plugins: { name: string }[] };
    expect(manifest.name).toBe(TEST_MARKETPLACE);
    expect(manifest.plugins.map((p) => p.name)).toEqual(['hooked', 'local-server', 'remote-server', 'skills-only']);
    expect(scratch.testSources.startsWith(userData)).toBe(true);
    expect(json(scratch.testSources)).toEqual([{ key: `test:${TEST_MARKETPLACE}`, label: 'MAWS Discover test marketplace', ownership: 'added', marketplaceName: TEST_MARKETPLACE, marketplaceSource: scratch.marketplace, manifestPath: join(scratch.marketplace, '.claude-plugin', 'marketplace.json') }]);
  });

  it('points the catalog at the recorded sources and the descriptor, and the engine at a scratch HOME', () => {
    const scratch = writeDiscoverScratch(userData, configDir);
    expect(Object.keys(scratch.env).sort()).toEqual(['HOME', 'MAWS_CATALOG_FIXTURES', 'MAWS_CATALOG_TEST_SOURCES']);
    expect(existsSync(join(scratch.env.MAWS_CATALOG_FIXTURES!, 'directory:plugins.json'))).toBe(true);
    expect(scratch.env.MAWS_CATALOG_TEST_SOURCES).toBe(scratch.testSources);
    expect(scratch.home).toBe(scratch.env.HOME);
    expect(existsSync(scratch.home!)).toBe(true);
  });

  it('keeps the runner’s HOME when the engine must reach the login Keychain', () => {
    const scratch = writeDiscoverScratch(userData, configDir, { home: 'runner' });
    expect(scratch.home).toBeNull();
    expect('HOME' in scratch.env).toBe(false);
  });

  it('points remote-server’s MCP server at the URL given, else leaves its placeholder', () => {
    const at = (scratch: { marketplace: string }) => (json(join(scratch.marketplace, 'plugins', 'remote-server', '.mcp.json')) as { mcpServers: { fixture: { url: string } } }).mcpServers.fixture.url;
    expect(at(writeDiscoverScratch(userData, configDir))).toBe(REMOTE_SERVER_PLACEHOLDER);
    expect(at(writeDiscoverScratch(mkdtempSync(join(userData, 'again-')), configDir, { remoteServerUrl: 'http://127.0.0.1:41000/mcp' }))).toBe('http://127.0.0.1:41000/mcp');
  });
});
