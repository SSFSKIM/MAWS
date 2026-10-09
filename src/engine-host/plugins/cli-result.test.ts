// E8 M1: the CLI's `--json` answers as the runner reads them, in the shapes G0's probe recorded on 2.1.290
// (`docs/doperpowers/evidence/p1-e8/g0-cli-probe.txt`) and SPEC 30 §25.3a describes.
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sourceKey } from '../../shared/plugins/source-key';
import { availableOf, installedOf, listing, marketplacesOf, mutationOutcome, pluginRowsOf } from './cli-result';

const INSTALLED = '{"command":"install","outcome":"ok","plugin":"e8-probe@e8-scratch","pluginId":"e8-probe@e8-scratch","scope":"user","message":"Successfully installed plugin: e8-probe@e8-scratch (scope: user)"}';
const NOT_FOUND = '{"command":"install","outcome":"failed","plugin":"nope@e8-scratch","scope":"user","message":"Plugin \\"nope\\" not found in marketplace \\"e8-scratch\\". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.","failureCode":"not_found"}';
const SHOWN = { sha256: 'f'.repeat(64), command: 'npx some-helper --fetch', kind: 'command-source' };

describe('mutationOutcome', () => {
  it('takes the last stdout line that parses as the result, after any progress lines', () => {
    expect(mutationOutcome({ stdout: `Cloning repository…\n${INSTALLED}\n`, stderr: '', code: 0 })).toEqual({ ok: true, result: JSON.parse(INSTALLED) });
    const update = '{"command":"marketplace-update","outcome":"ok","marketplace":"e8-scratch","message":"Validating local marketplace\\nSuccessfully updated marketplace: e8-scratch"}';
    expect(mutationOutcome({ stdout: `${update}\n`, stderr: '', code: 0 })).toEqual({ ok: true, result: JSON.parse(update) });
  });

  it('answers a failed result with the engine’s own message and failureCode', () => {
    expect(mutationOutcome({ stdout: `${NOT_FOUND}\n`, stderr: '', code: 1 })).toEqual({
      ok: false,
      error: { code: 'cli_failed', message: 'Plugin "nope" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`.', failureCode: 'not_found', shownCommand: null },
    });
    const noop = '{"command":"disable","outcome":"failed","plugin":"e8-probe@e8-scratch","message":"Plugin \\"e8-probe@e8-scratch\\" is already disabled","failureCode":"already_in_goal_state","alreadyInGoalState":true}';
    expect(mutationOutcome({ stdout: noop, stderr: '', code: 1 })).toMatchObject({ ok: false, error: { code: 'cli_failed', failureCode: 'already_in_goal_state' } });
  });

  it('carries shownCommand verbatim for the four codes that show a marketplace-declared command, and only for those', () => {
    for (const failureCode of ['command_source_refused', 'command_source_declined', 'entry_helper_unconfirmed', 'entry_helper_declined']) {
      const line = JSON.stringify({ command: 'install', outcome: 'failed', message: 'needs confirmation', failureCode, shownCommand: SHOWN });
      expect(mutationOutcome({ stdout: line, stderr: '', code: 1 }), failureCode).toEqual({ ok: false, error: { code: 'cli_failed', message: 'needs confirmation', failureCode, shownCommand: SHOWN } });
    }
    const other = JSON.stringify({ command: 'install', outcome: 'failed', message: 'x', failureCode: 'not_found', shownCommand: SHOWN });
    expect(mutationOutcome({ stdout: other, stderr: '', code: 1 })).toMatchObject({ ok: false, error: { shownCommand: null } });
  });

  it('fails no_result with stderr’s last non-empty line when the CLI printed no result (an argument error)', () => {
    expect(mutationOutcome({ stdout: '', stderr: 'error: unknown option \'--bogus\'\n\n', code: 1 })).toEqual({ ok: false, error: { code: 'no_result', message: "error: unknown option '--bogus'", failureCode: null, shownCommand: null } });
    expect(mutationOutcome({ stdout: '{"not":"a result"}\n', stderr: '', code: 1 })).toEqual({ ok: false, error: { code: 'no_result', message: 'the CLI exited 1 without a result', failureCode: null, shownCommand: null } });
    expect(mutationOutcome({ stdout: '', stderr: '', code: null })).toMatchObject({ ok: false, error: { code: 'no_result', message: 'the CLI ended without a result' } });
  });
});

describe('the reads', () => {
  it('reduces plugin list rows to the widget’s fields, keeping the times and projectEnabled (P2-B)', async () => {
    const stdout = JSON.stringify(
      [
        { id: 'e8-probe@e8-scratch', version: '0.1.0', scope: 'user', enabled: true, installPath: '/c/e8-probe/0.1.0', installedAt: '2026-10-09T07:35:54.762Z', lastUpdated: '2026-10-09T08:00:00.000Z', projectEnabled: true },
        { id: 'p@m', version: 'unknown', scope: 'project', enabled: false, installPath: '', projectPath: '/nowhere/r', errors: ['broken manifest'], notes: ['shadowed'], errorDetails: [{ type: 'manifest' }] },
        { id: 'loose', version: '1', scope: 'session', enabled: true, installPath: '/l' },
      ],
      null,
      2,
    );
    const placed = { here: false, coversHere: false };
    expect(await installedOf(pluginRowsOf(stdout), '/nowhere/cwd')).toEqual([
      { id: 'e8-probe@e8-scratch', name: 'e8-probe', marketplace: 'e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/c/e8-probe/0.1.0', errors: [], notes: [], installedAt: '2026-10-09T07:35:54.762Z', lastUpdated: '2026-10-09T08:00:00.000Z', projectEnabled: true, ...placed },
      { id: 'p@m', name: 'p', marketplace: 'm', version: 'unknown', scope: 'project', enabled: false, projectPath: '/nowhere/r', installPath: '', errors: ['broken manifest'], notes: ['shadowed'], installedAt: null, lastUpdated: null, projectEnabled: false, ...placed },
      { id: 'loose', name: 'loose', marketplace: '', version: '1', scope: 'session', enabled: true, projectPath: null, installPath: '/l', errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, ...placed },
    ]);
    expect(await installedOf(pluginRowsOf('[]'), '/nowhere')).toEqual([]);
  });

  it('never carries a row’s mcpServers, whose headers and environment values are verbatim (U3 F1)', async () => {
    const stdout = JSON.stringify([{ id: 'supabase@o', version: '0.1.15', scope: 'user', enabled: true, installPath: '/c/s', mcpServers: { supabase: { type: 'http', url: 'https://mcp.example/mcp?token=sk-secret-url', headers: { Authorization: 'Bearer sk-secret-header' }, env: { KEY: 'sk-secret-env' } } }, hasUserConfig: true }]);
    const rows = pluginRowsOf(stdout);
    expect(JSON.stringify(rows)).not.toContain('sk-secret'); // not even in what the host keeps
    expect(JSON.stringify(await installedOf(rows, '/nowhere'))).not.toContain('sk-secret');
  });

  it('reads the version of a folder-loaded plugin from its folder, and only for one', async () => {
    const stdout = JSON.stringify([
      { id: 'a@dir', version: '1.0.0', scope: 'user', enabled: true, installPath: '/c/a/1.0.0', readFromFolder: '/m/plugins/a', folderVersion: '1.2.0' },
      { id: 'b@dir', version: '1.0.0', scope: 'user', enabled: true, installPath: '/c/b/1.0.0', folderVersion: '9.9.9' },
      { id: 'c@dir', version: '1.0.0', scope: 'user', enabled: true, installPath: '/c/c/1.0.0', readFromFolder: '/m/plugins/c' },
    ]);
    const rows = pluginRowsOf(stdout);
    expect((await installedOf(rows, '/nowhere')).map((p) => p.version)).toEqual(['1.2.0', '1.0.0', '1.0.0']);
    expect(rows.map((r) => r.readFromFolder)).toEqual(['/m/plugins/a', null, '/m/plugins/c']); // the copy that loads: the manifest reader's anchor
    // an empty folder is none: never a path, and never a folder version
    const empty = pluginRowsOf(JSON.stringify([{ id: 'd@dir', version: '1.0.0', scope: 'user', enabled: true, installPath: '/c/d', readFromFolder: '', folderVersion: '9.9.9' }]));
    expect(empty[0].readFromFolder).toBeNull();
    expect((await installedOf(empty, '/nowhere'))[0].version).toBe('1.0.0');
  });

  describe('here and coversHere, through realpaths', () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'maws-p2b-places-'));
      for (const dir of ['proj/worktrees/w', 'proj2']) await mkdir(join(root, dir), { recursive: true });
      await symlink(join(root, 'proj'), join(root, 'alias'));
    });
    afterEach(() => rm(root, { recursive: true, force: true }));
    const row = (projectPath: string | null) => ({ id: 'p@m', version: '1', scope: projectPath === null ? 'user' : 'project', enabled: true, installPath: '/c', ...(projectPath === null ? {} : { projectPath }) });
    const placesOf = async (cwd: string, ...paths: (string | null)[]) => (await installedOf(pluginRowsOf(JSON.stringify(paths.map(row))), cwd)).map((p) => [p.here, p.coversHere]);

    it('one project however it is spelled: a link (as /tmp is to /private/tmp) and the realpath the CLI prints', async () => {
      const real = await realpath(join(root, 'proj'));
      expect(await placesOf(join(root, 'alias'), real, join(root, 'proj'))).toEqual([[true, true], [true, true]]);
    });

    it('a worktree under the project is covered by it, not here; a sibling sharing a prefix is neither', async () => {
      const cwd = join(root, 'proj', 'worktrees', 'w');
      expect(await placesOf(cwd, join(root, 'proj'), join(root, 'proj', 'worktrees', 'w'), join(root, 'proj2'))).toEqual([[false, true], [true, true], [false, false]]);
      expect(await placesOf(join(root, 'proj2'), join(root, 'proj'))).toEqual([[false, false]]); // `/proj2` is not under `/proj`
    });

    it('a user installation and a project that no longer exists are neither; so is everything from a cwd that does not resolve', async () => {
      expect(await placesOf(join(root, 'proj'), null, join(root, 'gone'))).toEqual([[false, false], [false, false]]);
      expect(await placesOf(join(root, 'gone'), join(root, 'proj'))).toEqual([[false, false]]);
    });
  });

  it('reduces list --available to its fields, the source reduced and the CLI’s own install count (P2-B)', () => {
    const stdout = JSON.stringify({
      installed: [],
      available: [
        { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', description: 'One skill and one command, for the probe', marketplaceName: 'e8-scratch', source: './plugins/e8-probe' },
        { pluginId: 'figma@anthropic-plugin-directory', name: 'figma', description: 'Figma', marketplaceName: 'anthropic-plugin-directory', version: '2.2.108', source: { source: 'url', url: 'https://x', sha: 'f'.repeat(40) }, installCount: 9 },
        { pluginId: 'fd@anthropic-plugin-directory', name: 'fd', marketplaceName: 'anthropic-plugin-directory', source: { source: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', path: 'plugins/frontend-design', ref: 'main' } },
        { pluginId: 'gh@o', name: 'gh', marketplaceName: 'o', source: { source: 'github', repo: 'a/b' }, installCount: 1290640 },
        { pluginId: 'pinned@o', name: 'pinned', marketplaceName: 'o', source: { source: 'github', repo: 'a/b', ref: 'v2' } },
        { pluginId: 'shaed@o', name: 'shaed', marketplaceName: 'o', source: { source: 'github', repo: 'a/b', ref: 'v2', sha: 'a'.repeat(40) } },
        { pluginId: 'odd@o', name: 'odd', marketplaceName: 'o', source: { url: 7 }, installCount: 1.5 },
        { pluginId: 'neg@o', name: 'neg', marketplaceName: 'o', source: 42, installCount: -3 },
        { pluginId: 'str@o', name: 'str', marketplaceName: 'o', installCount: '12' },
      ],
    });
    const none = { description: null, version: null };
    expect(availableOf(stdout)).toEqual([
      { pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'One skill and one command, for the probe', version: null, source: './plugins/e8-probe', installCount: null },
      { pluginId: 'figma@anthropic-plugin-directory', name: 'figma', marketplaceName: 'anthropic-plugin-directory', description: 'Figma', version: '2.2.108', source: { kind: 'url', url: 'https://x', repo: null, path: null, ref: null }, installCount: 9 },
      { pluginId: 'fd@anthropic-plugin-directory', name: 'fd', marketplaceName: 'anthropic-plugin-directory', ...none, source: { kind: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', repo: null, path: 'plugins/frontend-design', ref: 'main' }, installCount: null },
      { pluginId: 'gh@o', name: 'gh', marketplaceName: 'o', ...none, source: { kind: 'github', url: null, repo: 'a/b', path: null, ref: null }, installCount: 1290640 },
      // a ref is kept only where it decides the engine's key: a full commit sha beside it pins the code instead
      { pluginId: 'pinned@o', name: 'pinned', marketplaceName: 'o', ...none, source: { kind: 'github', url: null, repo: 'a/b', path: null, ref: 'v2' }, installCount: null },
      { pluginId: 'shaed@o', name: 'shaed', marketplaceName: 'o', ...none, source: { kind: 'github', url: null, repo: 'a/b', path: null, ref: null }, installCount: null },
      { pluginId: 'odd@o', name: 'odd', marketplaceName: 'o', ...none, source: { kind: 'unknown', url: null, repo: null, path: null, ref: null }, installCount: null },
      { pluginId: 'neg@o', name: 'neg', marketplaceName: 'o', ...none, source: null, installCount: null },
      { pluginId: 'str@o', name: 'str', marketplaceName: 'o', ...none, source: null, installCount: null },
    ]);
  });

  it('reduces marketplace list rows to name, source kind, locator, the branch or tag it is pinned to, and install location', () => {
    const stdout = JSON.stringify([
      { name: 'e8-scratch', source: 'directory', path: '/tmp/e8-g0/run1/market', installLocation: '/tmp/e8-g0/run1/market' },
      { name: 'gh', source: 'github', repo: 'owner/repo', ref: 'main', installLocation: '/c/plugins/marketplaces/gh' },
      { name: 'u', source: 'url', url: 'https://example.com/m.json', installLocation: '/c/plugins/marketplaces/u' },
      { name: 'org', source: 'claudeai', marketplaceId: 'mk', organizationUuid: 'o', status: 'ok' },
      { name: 'blank', source: 'github', repo: 'o/b', installLocation: '' },
    ]);
    expect(marketplacesOf(stdout)).toEqual([
      { name: 'e8-scratch', source: 'directory', locator: '/tmp/e8-g0/run1/market', ref: null, installLocation: '/tmp/e8-g0/run1/market' },
      { name: 'gh', source: 'github', locator: 'owner/repo', ref: 'main', installLocation: '/c/plugins/marketplaces/gh' }, // P2-B: the ref decides its relative entries' fold key
      { name: 'u', source: 'url', locator: 'https://example.com/m.json', ref: null, installLocation: '/c/plugins/marketplaces/u' },
      { name: 'org', source: 'claudeai', locator: null, ref: null, installLocation: null },
      { name: 'blank', source: 'github', locator: 'o/b', ref: null, installLocation: null }, // P2-B: an empty location is none
    ]);
  });

  // P2-B: the reduction and the key together give the engine's fold (2.1.292 `Sb`/`x5`, cli.pretty.js:832435-832464)
  it('keys what the engine folds and nothing it refuses, read from the CLI’s own rows', () => {
    const entry = (source: unknown) => availableOf(JSON.stringify({ available: [{ pluginId: 'x@m', name: 'x', marketplaceName: 'm', source }] }))[0].source;
    const repo = { source: 'github', repo: 'anthropics/claude-plugins-official', path: 'plugins/x' };
    const key = 'github.com/anthropics/claude-plugins-official#plugins/x';
    expect(sourceKey(entry(repo), null)).toBe(key);
    expect(sourceKey(entry({ ...repo, ref: 'f'.repeat(40) }), null)).toBeNull(); // a sha-looking ref is still a ref
    expect(sourceKey(entry({ ...repo, ref: 'v2', sha: 'a'.repeat(40) }), null)).toBe(key); // a separate sha pins the code
    const [pinned, unpinned] = marketplacesOf(
      JSON.stringify([
        { name: 'claude-plugins-official', source: 'github', repo: 'anthropics/claude-plugins-official', ref: 'v2', installLocation: '/clone' },
        { name: 'claude-plugins-official', source: 'github', repo: 'anthropics/claude-plugins-official', installLocation: '/clone' },
      ]),
    );
    expect(sourceKey(entry('./plugins/x'), pinned)).toBeNull();
    expect(sourceKey(entry('./plugins/x'), unpinned)).toBe(key);
  });

  it('answers a listing only from a CLI that exited 0, else with its own last words', () => {
    expect(listing({ stdout: '[]', stderr: '', code: 0 }, pluginRowsOf)).toEqual([]);
    expect(() => listing({ stdout: '', stderr: 'Error: settings.json is not valid JSON\n', code: 1 }, pluginRowsOf)).toThrow('Error: settings.json is not valid JSON');
    expect(() => listing({ stdout: '', stderr: '', code: 2 }, pluginRowsOf)).toThrow('the CLI exited 2 without a listing');
  });

  it('refuses an answer that is not the documented document, naming what it read', () => {
    expect(() => pluginRowsOf('not json')).toThrow(/plugin list --json/);
    expect(() => pluginRowsOf('{"installed":[]}')).toThrow(/plugin list --json/);
    expect(() => availableOf('[]')).toThrow(/--available/);
    expect(() => marketplacesOf('{}')).toThrow(/marketplace list --json/);
  });
});
