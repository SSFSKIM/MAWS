// P4-AGG M2: `plugins.marketplaceManifest`'s reading of one marketplace's clone: its owner, and for every entry its
// author, its source with both pins, and what the plugin contains when it sits in the clone (read as `plugins.manifest`
// reads one plugin, under one deadline for the whole marketplace). An added marketplace that neither the directory nor
// the seeds know still yields its author, its skills and whether a server runs on the computer.
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands } from '@shared/ipc/schema/plugins';
import { readMarketplaceManifest } from './manifest';

const TEST_MARKETPLACE = resolve(__dirname, '../../../e2e/fixtures/catalog/marketplace');
const RECORDED = resolve(__dirname, '../../../test/fixtures/catalog/marketplace-manifest.json');
const output = commands['plugins.marketplaceManifest'].output;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-agg-market-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function tree(base: string, files: Record<string, string | object>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    const at = join(base, path);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return base;
}

// A marketplace that neither the directory nor the seeds list: a local plugin with skills and a stdio server, a remote
// entry pinned by ref and sha, and two `strict: false` entries sharing the clone's root, each naming its own skills.
const UNKNOWN_MARKETPLACE = {
  '.claude-plugin/marketplace.json': {
    name: 'scratch-market',
    owner: { name: 'Scratch Owner' },
    plugins: [
      { name: 'tooling', source: './plugins/tooling', description: 'Local tooling', author: { name: 'Tool Smith' } },
      { name: 'remote', source: { source: 'github', repo: 'someone/remote-plugin', ref: 'v1', sha: 'b'.repeat(40) }, description: 'Remote' },
      { name: 'docs-a', source: './', strict: false, skills: ['./skills/alpha'] },
      { name: 'docs-b', source: './', strict: false, skills: ['./skills/beta', './skills/gamma'] },
      { source: './plugins/nameless' },
    ],
  },
  'plugins/tooling/.claude-plugin/plugin.json': { name: 'tooling', version: '1.0.0' },
  'plugins/tooling/skills/lint/SKILL.md': '---\nname: lint\ndescription: Lints\n---\n',
  'plugins/tooling/.mcp.json': { mcpServers: { runner: { command: 'node', args: ['x.mjs'], env: { TOKEN: 'secret' } } } },
  'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: A\n---\n',
  'skills/beta/SKILL.md': '---\nname: beta\ndescription: B\n---\n',
  'skills/gamma/SKILL.md': '---\nname: gamma\ndescription: C\n---\n',
};

describe('readMarketplaceManifest', () => {
  it('reads the local test marketplace: its owner, and each plugin’s author and contents from the clone', async () => {
    const answer = await readMarketplaceManifest(TEST_MARKETPLACE);
    expect(output.safeParse(answer).success).toBe(true);
    expect(answer.state).toBe('read');
    expect(answer.owner).toBe('MAWS e2e');
    const byName = Object.fromEntries(answer.plugins.map((p) => [p.name, p]));
    expect(Object.keys(byName)).toEqual(['hooked', 'local-server', 'remote-server', 'skills-only']);
    expect(byName.hooked).toMatchObject({ author: 'MAWS e2e hooks', description: 'A plugin whose one component is a hook.', source: './plugins/hooked', partial: false, problems: [] });
    expect(byName.hooked!.components!.hooks).toEqual([{ event: 'SessionStart', matcher: null }]);
    expect(byName['local-server']!.components!.mcpServers).toEqual([{ name: 'echo', transport: 'stdio' }]);
    expect(byName['remote-server']!.components!.mcpServers).toEqual([{ name: 'fixture', transport: 'http' }]);
    expect(byName['skills-only']!.components!.skills.map((s) => s.name).sort()).toEqual(['greet', 'summarize-diff']);
    // the recorded answer the catalog's unit tests take (test/fixtures/catalog/marketplace-manifest.json)
    expect({ engine: 'plugins.marketplaceManifest', marketplace: 'maws-discover-test', output: answer }).toEqual(JSON.parse(readFileSync(RECORDED, 'utf8')));
  });

  it('reads a marketplace no other source knows: author, skills, a stdio server, a remote entry’s pins, shared-root entries apart', async () => {
    const answer = await readMarketplaceManifest(await tree(root, UNKNOWN_MARKETPLACE));
    expect(output.safeParse(answer).success).toBe(true);
    expect(answer.owner).toBe('Scratch Owner');
    const [tooling, remote, docsA, docsB, ...rest] = answer.plugins;
    expect(rest).toEqual([]); // an entry with no name is no plugin
    expect(tooling).toMatchObject({ name: 'tooling', author: 'Tool Smith', description: 'Local tooling', source: './plugins/tooling', partial: false });
    expect(tooling!.components!.mcpServers).toEqual([{ name: 'runner', transport: 'stdio' }]);
    expect(tooling!.components!.skills.map((s) => s.name)).toEqual(['lint']);
    expect(JSON.stringify(answer)).not.toContain('secret'); // redaction holds: names and kinds only
    // a remote entry is not on disk: its contents are unknown until installed, its pins kept whole
    expect(remote).toEqual({ name: 'remote', author: null, description: 'Remote', source: { kind: 'github', url: null, repo: 'someone/remote-plugin', path: null, ref: 'v1', sha: 'b'.repeat(40) }, components: null, partial: false, problems: [] });
    expect(docsA!.components!.skills.map((s) => s.name)).toEqual(['alpha']);
    expect(docsB!.components!.skills.map((s) => s.name)).toEqual(['beta', 'gamma']);
  });

  it('reads marketplace.json once for the whole marketplace', async () => {
    const at = await tree(root, UNKNOWN_MARKETPLACE);
    const opened: string[] = [];
    const fs = { ...fsp, open: (async (path: string, ...rest: unknown[]) => (opened.push(String(path)), (fsp.open as (...a: unknown[]) => unknown)(path, ...rest))) as typeof fsp.open };
    await readMarketplaceManifest(at, { fs });
    expect(opened.filter((path) => path.endsWith('marketplace.json'))).toHaveLength(1);
  });

  it('answers missing for an absent clone and unknown for a clone without a readable manifest', async () => {
    expect(await readMarketplaceManifest(join(root, 'gone'))).toEqual({ state: 'missing', owner: null, plugins: [] });
    await tree(root, { 'README.md': '# none' });
    expect(await readMarketplaceManifest(root)).toEqual({ state: 'unknown', owner: null, plugins: [] });
    await tree(root, { '.claude-plugin/marketplace.json': '{ not json' });
    expect(await readMarketplaceManifest(root)).toEqual({ state: 'unknown', owner: null, plugins: [] });
  });

  it('past the deadline, the entries it did not reach say partial with their contents unknown', async () => {
    const at = await tree(root, UNKNOWN_MARKETPLACE);
    let late = false; // the clock passes the deadline once the first plugin's files are opened
    const fs = { ...fsp, open: (async (path: string, ...rest: unknown[]) => ((late ||= String(path).includes('/plugins/tooling/')), (fsp.open as (...a: unknown[]) => unknown)(path, ...rest))) as typeof fsp.open };
    const answer = await readMarketplaceManifest(at, { fs, now: () => (late ? 2_000 : 0), deadline: 1_000 });
    expect(answer.state).toBe('read');
    const byName = Object.fromEntries(answer.plugins.map((p) => [p.name, p]));
    expect(byName.tooling!.partial).toBe(true);
    expect(byName['docs-a']).toMatchObject({ components: null, partial: true });
    expect(byName['docs-b']).toMatchObject({ components: null, partial: true });
    expect(byName.remote).toMatchObject({ components: null, partial: false }); // never on disk: nothing to reach
  });
});
