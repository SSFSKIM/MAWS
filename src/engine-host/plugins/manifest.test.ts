// P2-B M2: the manifest reader (P2-B execution document §5.5) on fixture trees: the manifest composed as the engine
// composes it, components per kind by the engine's rules, confinement to the anchors' realpaths, regular files only, the
// bounds, and redaction (names, kinds and counts; a fixed problem vocabulary; never an exception's message or a file's
// value). The shapes are the engine's (2.1.292 `cli.pretty.js:673281-673299`, `:806207-806240`) and the owner's
// installed plugins' (code-review, supabase, an LSP plugin with no plugin.json), read once, read-only.
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import * as fsp from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import { PluginManifestViewSchema } from '@shared/ipc/schema/plugins';
import { readManifestView, type ManifestAnchors, type ManifestReaderDeps } from './manifest';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-p2b-manifest-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

type Tree = Record<string, string | object | { link: string }>;
const isLink = (value: unknown): value is { link: string } => typeof value === 'object' && value !== null && 'link' in value && Object.keys(value).length === 1;
async function tree(base: string, files: Tree): Promise<string> {
  await mkdir(base, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const at = join(base, path);
    await mkdir(dirname(at), { recursive: true });
    if (isLink(content)) await symlink(content.link, at);
    else await writeFile(at, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return base;
}

const INSTALLATION: ManifestItemRef = { kind: 'installation', id: 'p@m', scope: 'user', projectPath: null };
const md = (fields: Record<string, string>, body = 'Body') => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}\n`;

async function view(anchors: Partial<ManifestAnchors>, key: ManifestItemRef = INSTALLATION, deps?: ManifestReaderDeps): Promise<PluginManifestView> {
  const answer = await readManifestView(key, { root: null, marketplaceRoot: null, entryName: 'p', ...anchors }, deps);
  expect(PluginManifestViewSchema.safeParse(answer).success).toBe(true); // every answer is the contract's shape
  return answer;
}
const names = (items: readonly { name: string }[]) => items.map((i) => i.name);
const market = (plugins: object[], name = 'm') => ({ '.claude-plugin/marketplace.json': { name, owner: { name: 'o' }, plugins } });

describe('what the plugin says about itself', () => {
  it('reads plugin.json’s name, display name, version, description, author, license and keywords', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'code-review', displayName: 'Code Review', version: '1.2.0', description: 'Reviews pull requests', author: { name: 'Anthropic', email: 'support@anthropic.com' }, license: 'MIT', keywords: ['review', 7, 'git'], homepage: 'https://example.com', icon: 'x.png' },
    });
    expect(await view({ root: plugin })).toMatchObject({ key: INSTALLATION, state: 'read', name: 'code-review', displayName: 'Code Review', version: '1.2.0', marketplaceVersion: null, description: 'Reviews pull requests', author: 'Anthropic', license: 'MIT', keywords: ['review', 'git'], partial: false, problems: [] });
  });

  it('with no display name or version says none; with no plugin.json and no entry the name falls back to the entry’s', async () => {
    const plain = await tree(join(root, 'plain'), { '.claude-plugin/plugin.json': { name: 'plain' } });
    expect(await view({ root: plain })).toMatchObject({ state: 'read', name: 'plain', displayName: null, version: null, description: null, author: null });
    const bare = await tree(join(root, 'bare'), { 'README.md': '# readme' });
    expect(await view({ root: bare, entryName: 'bare' })).toMatchObject({ state: 'read', name: 'bare', displayName: null, description: null, problems: [] });
  });

  it('with no plugin.json, the marketplace entry is the manifest (an LSP plugin of claude-plugins-official)', async () => {
    const plugin = await tree(join(root, 'cache/typescript-lsp/1.0.0'), { LICENSE: 'Apache', 'README.md': '# TypeScript' });
    const marketplace = await tree(join(root, 'official'), market([
      { name: 'other', source: './plugins/other' },
      { name: 'typescript-lsp', description: 'TypeScript/JavaScript language server', version: '1.0.0', author: { name: 'Anthropic', email: 'support@anthropic.com' }, source: './plugins/typescript-lsp', strict: false, lspServers: { typescript: { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } } } },
    ]));
    const answer = await view({ root: plugin, marketplaceRoot: marketplace, entryName: 'typescript-lsp' });
    expect(answer).toMatchObject({ state: 'read', name: 'typescript-lsp', version: '1.0.0', marketplaceVersion: '1.0.0', description: 'TypeScript/JavaScript language server', author: 'Anthropic', problems: [] });
    expect(answer.components.lspServers).toEqual([{ name: 'typescript' }]);
    expect(JSON.stringify(answer)).not.toContain('typescript-language-server'); // never a server's command
  });

  it('with both, the entry’s metadata overlays the file’s and its components add to the file’s', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', version: '2.0.0', description: 'From the file', author: { name: 'File author' }, license: 'MIT', commands: './cmds/one.md' },
      'cmds/one.md': md({ description: 'One' }),
      'extra/two.md': md({ description: 'Two' }),
      'commands/ignored.md': md({ description: 'Not read: plugin.json names its commands' }),
    });
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'p', source: './p', version: '2.1.0', description: 'From the entry', displayName: 'Shown P', author: { name: 'Entry author' }, keywords: ['k'], commands: ['./extra/two.md'] }]));
    const answer = await view({ root: plugin, marketplaceRoot: marketplace });
    expect(answer).toMatchObject({ name: 'p', displayName: 'Shown P', version: '2.0.0', marketplaceVersion: '2.1.0', description: 'From the entry', author: 'Entry author', license: 'MIT', keywords: ['k'] });
    expect(answer.components.commands).toEqual([{ name: 'one', description: 'One' }, { name: 'two', description: 'Two' }]);
  });

  it('an entry with a blank description keeps the file’s', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p', description: 'File words' } });
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'p', source: './p', description: '   ' }]));
    expect((await view({ root: plugin, marketplaceRoot: marketplace })).description).toBe('File words');
  });
});

describe('what it contains, per kind by the engine’s rules', () => {
  it('reads the default folders: commands (nested as dir:name), agents, skills, hooks, .mcp.json, .lsp.json, monitors', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p' },
      'commands/hello.md': md({ description: 'Says hello' }),
      'commands/git/commit.md': md({ description: 'Commits' }),
      'commands/notes.txt': 'not a command',
      'agents/reviewer.md': md({ name: 'code-reviewer', description: 'Reviews code' }),
      'agents/plain.md': '# No front matter',
      'agents/deep/nested.md': md({ name: 'nested-agent', description: 'Nested' }),
      'agents/Loud.MD': md({ name: 'loud-agent' }),
      'agents/notes.txt': 'not an agent',
      'skills/writing/SKILL.md': md({ name: 'writing-well', description: 'Writes' }),
      'skills/bare/SKILL.md': 'No front matter at all',
      'skills/empty/README.md': 'no skill here',
      'hooks/hooks.json': { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check' }] }, { hooks: [] }], SessionStart: [{ matcher: 'startup|resume', hooks: [] }] } },
      '.mcp.json': { mcpServers: { local: { command: 'node', args: ['server.js'] }, remote: { type: 'http', url: 'https://example.com/mcp' }, events: { type: 'sse', url: 'https://example.com/sse' }, socket: { type: 'ws', url: 'wss://example.com' }, odd: { type: 'sdk' } } },
      '.lsp.json': { python: { command: 'pyright-langserver', extensionToLanguage: { '.py': 'python' } } },
      'monitors/monitors.json': [{ name: 'ci', command: 'gh run watch', description: 'Watches CI' }],
    });
    const { components, problems } = await view({ root: plugin });
    expect(problems).toEqual([]);
    expect(components.commands).toEqual([{ name: 'git:commit', description: 'Commits' }, { name: 'hello', description: 'Says hello' }]);
    // agents/**/*.md, recursively (2.1.292 `HH` :729782-729814), a nested agent named through its folders as commands are
    expect(components.agents).toEqual([{ name: 'loud-agent', description: null }, { name: 'deep:nested-agent', description: 'Nested' }, { name: 'plain', description: null }, { name: 'code-reviewer', description: 'Reviews code' }]);
    expect(components.skills).toEqual([{ name: 'bare', description: null }, { name: 'writing-well', description: 'Writes' }]);
    expect(components.hooks).toEqual([{ event: 'PreToolUse', matcher: 'Bash' }, { event: 'PreToolUse', matcher: null }, { event: 'SessionStart', matcher: 'startup|resume' }]);
    expect(components.hookModules).toBe(0);
    expect(components.mcpServers).toEqual([{ name: 'local', transport: 'stdio' }, { name: 'remote', transport: 'http' }, { name: 'events', transport: 'sse' }, { name: 'socket', transport: 'ws' }, { name: 'odd', transport: 'unknown' }]);
    expect(components.lspServers).toEqual([{ name: 'python' }]);
    expect(components.monitors).toEqual([{ name: 'ci', description: 'Watches CI' }]);
  });

  it('supabase’s shape: skills "./skills/" adds without doubling, mcpServers names a file, agents/claude/ is never agents', async () => {
    const plugin = await tree(join(root, 'supabase/0.1.15'), {
      '.claude-plugin/plugin.json': { name: 'supabase', version: '0.1.15', author: { name: 'Supabase', url: 'https://supabase.com' }, skills: './skills/', mcpServers: './agents/claude/.mcp.json', keywords: ['supabase'] },
      'skills/supabase/SKILL.md': md({ name: 'supabase', description: 'Works with Supabase' }),
      'skills/supabase-postgres-best-practices/SKILL.md': md({ name: 'supabase-postgres-best-practices', description: 'Postgres' }),
      'agents/claude/.mcp.json': { mcpServers: { supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp', headers: { 'X-Source-Name': 'claude-code-plugin' } } } },
      'agents/codex/config.toml': 'x = 1',
    });
    const { components, problems } = await view({ root: plugin });
    expect(problems).toEqual([]);
    expect(names(components.skills)).toEqual(['supabase', 'supabase-postgres-best-practices']);
    expect(components.mcpServers).toEqual([{ name: 'supabase', transport: 'http' }]);
    expect(components.agents).toEqual([]);
  });

  it('a commands object map: each name with its description, else its source file’s', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', commands: { about: { source: './docs/about.md' }, status: { source: './docs/status.md', description: 'Overridden' }, inline: { content: md({ description: 'Inline words' }) } } },
      'docs/about.md': md({ description: 'About this plugin' }),
      'docs/status.md': md({ description: 'Not shown' }),
    });
    expect((await view({ root: plugin })).components.commands).toEqual([{ name: 'about', description: 'About this plugin' }, { name: 'status', description: 'Overridden' }, { name: 'inline', description: 'Inline words' }]);
  });

  it('agents and monitors named by the manifest replace their default folders; skills, hooks, MCP and LSP servers add', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': {
        name: 'p', agents: ['./roles/lead.md'], monitors: [{ name: 'inline-monitor', command: 'tail -f log', description: 'Inline' }], skills: ['./more-skills/extra'],
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, mcpServers: { inline: { command: 'x' } }, lspServers: [{ go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } }, './lsp/rust.json'],
      },
      'agents/default.md': md({ name: 'default-agent' }),
      'roles/lead.md': md({ name: 'lead', description: 'Leads' }),
      'monitors/monitors.json': [{ name: 'default-monitor', command: 'x', description: 'Not read' }],
      'skills/base/SKILL.md': md({ name: 'base' }),
      'more-skills/extra/SKILL.md': md({ name: 'extra' }),
      'hooks/hooks.json': { hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [] }] } },
      '.mcp.json': { mcpServers: { file: { command: 'y' } } },
      '.lsp.json': { python: { command: 'p' } },
      'lsp/rust.json': { rust: { command: 'rust-analyzer' } },
    });
    const { components } = await view({ root: plugin });
    expect(names(components.agents)).toEqual(['lead']);
    expect(components.monitors).toEqual([{ name: 'inline-monitor', description: 'Inline' }]);
    expect(names(components.skills)).toEqual(['base', 'extra']);
    expect(components.hooks.map((h) => h.event)).toEqual(['PreToolUse', 'Stop']);
    expect(names(components.mcpServers)).toEqual(['file', 'inline']);
    expect(names(components.lspServers)).toEqual(['python', 'go', 'rust']);
  });

  it('a declared agents folder is scanned recursively and replaces the default; a declared file must be Markdown', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', agents: ['./roles', './extra/one.md', './extra/notes.txt'] },
      'roles/a.md': md({ name: 'worker', description: 'Works' }),
      'roles/sub/b.md': md({ description: 'B' }),
      'extra/one.md': md({ name: 'one' }),
      'extra/notes.txt': 'not an agent',
      'agents/default.md': md({ name: 'not-read' }),
    });
    const { components, problems } = await view({ root: plugin });
    expect(problems).toEqual([]);
    expect(components.agents).toEqual([{ name: 'worker', description: 'Works' }, { name: 'sub:b', description: 'B' }, { name: 'one', description: null }]);
    const single = await tree(join(root, 'single'), { '.claude-plugin/plugin.json': { name: 'p', agents: './roles' }, 'roles/a.md': md({ name: 'worker', description: 'Works' }) });
    expect((await view({ root: single })).components.agents).toEqual([{ name: 'worker', description: 'Works' }]);
  });

  it('reads a component field under experimental beside the top-level one', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', skills: './a', experimental: { skills: './b', monitors: './watch.json' } },
      'a/SKILL.md': md({ name: 'a' }),
      'b/SKILL.md': md({ name: 'b' }),
      'watch.json': [{ name: 'w', command: 'x', description: 'Watches' }],
    });
    const { components } = await view({ root: plugin });
    expect(names(components.skills)).toEqual(['a', 'b']);
    expect(names(components.monitors)).toEqual(['w']);
  });

  it('counts a hooks module and an MCPB bundle (by path or URL) without reading or fetching either', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', mcpServers: ['./server.mcpb', 'https://example.com/tool.dxt'] },
      'hooks/hooks.json': { description: 'mods', modules: ['./mods/register.tsx'], hooks: { SessionStart: [{ matcher: 'startup', hooks: [] }] } },
      'server.mcpb': 'binary',
    });
    const recorded = recording();
    const { components, problems } = await view({ root: plugin }, INSTALLATION, { fs: recorded.fs });
    expect(problems).toEqual([]);
    expect(recorded.touched().filter((path) => /server\.mcpb|register\.tsx|tool\.dxt/.test(path))).toEqual([]); // neither opened, resolved nor stated
    expect(components.hookModules).toBe(1);
    expect(components.mcpBundles).toBe(2);
    expect(components.mcpServers).toEqual([]);
  });

  it('a field of a shape the reader does not know reads empty with `unknown shape`, never a throw', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', commands: 42, agents: { a: 1 }, mcpServers: true, monitors: 'x', hooks: 'not-json.txt', lspServers: [7] },
      'commands/kept.md': md({ description: 'not read: commands is named' }),
      'hooks/hooks.json': { hooks: 'oops' },
      'x': '{"not": "an array"}',
    });
    const answer = await view({ root: plugin });
    expect(answer.state).toBe('read');
    expect(answer.components).toMatchObject({ commands: [], agents: [], mcpServers: [], monitors: [], lspServers: [], hooks: [] });
    expect(answer.problems).toEqual(expect.arrayContaining(['.claude-plugin/plugin.json: unknown shape', 'hooks/hooks.json: unknown shape', 'x: unknown shape']));
    expect(answer.problems.every((p) => /: (not valid JSON|too large|outside the plugin|not a regular file|could not be read|unknown shape)$/.test(p))).toBe(true);
  });
});

describe('confinement and regular files', () => {
  it('skips a symlink inside skills/ that leaves the plugin, as `outside the plugin`', async () => {
    const outside = await tree(join(root, 'elsewhere'), { 'SKILL.md': md({ name: 'escaped', description: 'sk-secret-outside' }) });
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p' },
      'skills/inside/SKILL.md': md({ name: 'inside' }),
      'skills/etc': { link: '/etc' },
      'skills/sibling': { link: outside },
    });
    const answer = await view({ root: plugin });
    expect(names(answer.components.skills)).toEqual(['inside']);
    expect(answer.problems).toEqual(['skills/etc: outside the plugin', 'skills/sibling: outside the plugin']);
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
  });

  it('a sibling directory sharing the plugin’s prefix is outside it (`/p2` is not under `/p`)', async () => {
    await tree(join(root, 'p2'), { 'leak.md': md({ description: 'sk-secret-prefix' }) });
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p', agents: ['../p2/leak.md'] }, 'commands/leak.md': { link: join(root, 'p2', 'leak.md') } });
    const answer = await view({ root: plugin });
    expect(answer.components).toMatchObject({ commands: [], agents: [] });
    expect(answer.problems).toHaveLength(2);
    expect(answer.problems).toEqual(expect.arrayContaining(['.claude-plugin/plugin.json: outside the plugin', 'commands/leak.md: outside the plugin']));
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
  });

  it('a declared file reached through a linked folder that leaves the plugin is refused', async () => {
    const outside = await tree(join(root, 'outside'), { 'a.md': md({ name: 'escaped', description: 'sk-secret-outside' }) });
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p', agents: './roles/a.md' }, roles: { link: outside } });
    const answer = await view({ root: plugin });
    expect(answer.components.agents).toEqual([]);
    expect(answer.problems).toEqual(['roles/a.md: outside the plugin']);
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
  });

  it('a link inside the plugin to another of its files is read; the anchor itself may be a link', async () => {
    const plugin = await tree(join(root, 'real'), { '.claude-plugin/plugin.json': { name: 'p' }, 'shared/review.md': md({ description: 'Shared' }), 'commands/review.md': { link: '../shared/review.md' } });
    await symlink(plugin, join(root, 'alias'));
    expect((await view({ root: join(root, 'alias') })).components.commands).toEqual([{ name: 'review', description: 'Shared' }]);
  });

  // P2-F L136: confinement is checked by realpath before the open, and Node offers no descriptor-relative open, so the
  // reader re-resolves the path after the open and compares the descriptor's identity with the path's file.
  describe('an ancestor directory swapped for a link between the check and the open', () => {
    // At the open of `commands/review.md`, `commands` is moved aside and replaced by a link to a folder outside the
    // plugin holding a file of the same name; `restore` moves the plugin's own folder back once the open has happened.
    async function swapping(restore: boolean) {
      const outside = await tree(join(root, 'outside'), { 'review.md': md({ description: 'sk-secret-swapped' }) });
      const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p' }, 'commands/review.md': md({ description: 'Inside' }) });
      const commands = join(plugin, 'commands');
      const fs: ManifestReaderDeps['fs'] = {
        ...fsp,
        open: (async (path: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
          const swap = String(path).endsWith(join('commands', 'review.md'));
          if (swap) {
            await fsp.rename(commands, `${commands}.moved`);
            await symlink(outside, commands);
          }
          const handle = await (fsp.open as (...a: unknown[]) => Promise<FileHandle>)(path, ...rest);
          if (swap && restore) {
            await rm(commands);
            await fsp.rename(`${commands}.moved`, commands);
          }
          return handle;
        }) as typeof fsp.open,
      };
      return view({ root: plugin }, INSTALLATION, { fs });
    }

    it('left in place: the file re-resolves outside the plugin and is refused', async () => {
      const answer = await swapping(false);
      expect(answer.components.commands).toEqual([{ name: 'review', description: null }]); // named by its own entry, nothing of the file read
      expect(answer.problems).toEqual(['commands/review.md: outside the plugin']);
      expect(JSON.stringify(answer)).not.toContain('sk-secret');
    });

    it('swapped back after the open: the descriptor is not the confined path’s file, so it is not read', async () => {
      const answer = await swapping(true);
      expect(answer.components.commands).toEqual([{ name: 'review', description: null }]);
      expect(answer.problems).toEqual(['commands/review.md: could not be read']);
      expect(JSON.stringify(answer)).not.toContain('sk-secret');
    });
  });

  // F-AB (scale review A scalpel-4#1): a folder is listed by path, so it is opened first and once listed its path must
  // still name the opened folder under the anchor; else none of its names is used and no outside name reaches a problem.
  describe('an ancestor directory swapped for a link while a folder is listed', () => {
    // At the first touch of `commands/nested` for its listing (its open, or the listing itself), its ancestor `commands`
    // is moved aside and replaced by a link to a folder outside the plugin; `restore` moves the plugin's own folder back
    // once `commands/nested` is listed.
    async function swapping(restore: boolean) {
      const outside = await tree(join(root, 'outside'), { 'nested/sk-secret-name.md': md({ description: 'x' }) });
      const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p' }, 'commands/nested/review.md': md({ description: 'Inside' }) });
      const commands = join(plugin, 'commands');
      const listed = await fsp.realpath(join(commands, 'nested'));
      let swapped = false;
      const swapIn = async (path: unknown) => {
        if (swapped || String(path) !== listed) return;
        swapped = true;
        await fsp.rename(commands, `${commands}.moved`);
        await symlink(outside, commands);
      };
      const fs: ManifestReaderDeps['fs'] = {
        ...fsp,
        open: (async (path: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
          await swapIn(path);
          return (fsp.open as (...a: unknown[]) => Promise<FileHandle>)(path, ...rest);
        }) as typeof fsp.open,
        readdir: (async (path: Parameters<typeof fsp.readdir>[0], ...rest: unknown[]) => {
          await swapIn(path);
          const names = await (fsp.readdir as (...a: unknown[]) => Promise<string[]>)(path, ...rest);
          if (restore && String(path) === listed) {
            await rm(commands);
            await fsp.rename(`${commands}.moved`, commands);
          }
          return names;
        }) as typeof fsp.readdir,
      };
      return view({ root: plugin }, INSTALLATION, { fs });
    }

    it('left in place: the folder re-resolves outside the plugin and none of its names is used', async () => {
      const answer = await swapping(false);
      expect(answer.components.commands).toEqual([]);
      expect(answer.problems).toEqual(['commands/nested: outside the plugin']);
      expect(JSON.stringify(answer)).not.toContain('sk-secret');
    });

    it('swapped back after the listing: the listed folder is not the confined path’s, so its names are dropped', async () => {
      const answer = await swapping(true);
      expect(answer.components.commands).toEqual([]);
      expect(answer.problems).toEqual(['commands/nested: could not be read']);
      expect(JSON.stringify(answer)).not.toContain('sk-secret');
    });
  });

  it('reads only regular files: a directory where a file should be is `not a regular file`', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p' }, '.mcp.json/inner': 'x' });
    expect((await view({ root: plugin })).problems).toEqual(['.mcp.json: not a regular file']);
  });

  it('a JSON file over 256 KiB is `too large`, read no further; a large Markdown file is read only to its front matter', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p' },
      '.mcp.json': JSON.stringify({ mcpServers: { big: { command: 'x', pad: 'x'.repeat(300 * 1024) } } }),
      'commands/long.md': md({ description: 'Long' }, 'x'.repeat(400 * 1024)),
    });
    const recorded = recording();
    const answer = await view({ root: plugin }, INSTALLATION, { fs: recorded.fs });
    expect(answer.problems).toEqual(['.mcp.json: too large']);
    expect(answer.partial).toBe(true); // a bound excluded a file: never a complete view, never cached
    expect(answer.components.mcpServers).toEqual([]);
    expect(answer.components.commands).toEqual([{ name: 'long', description: 'Long' }]);
    expect(recorded.bytesOf('commands/long.md')).toBeLessThanOrEqual(8 * 1024); // the head only, never the whole file
    expect(recorded.bytesOf('.mcp.json')).toBeLessThanOrEqual(256 * 1024 + 1); // stopped one byte past the bound
  });

  it('a marketplace.json past 8 MiB is `too large` and the view partial', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p' } });
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'p', source: './p', pad: 'x'.repeat(8 * 1024 * 1024) }]));
    const answer = await view({ root: plugin, marketplaceRoot: marketplace });
    expect(answer).toMatchObject({ state: 'read', partial: true, problems: ['.claude-plugin/marketplace.json: too large'] });
  });

  it('reads a marketplace.json up to 8 MiB', async () => {
    const plugin = await tree(join(root, 'p'), { 'README.md': 'x' });
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'p', source: './p', description: 'From a large catalogue', pad: 'x'.repeat(1024 * 1024) }]));
    expect((await view({ root: plugin, marketplaceRoot: marketplace })).description).toBe('From a large catalogue');
  });
});

describe('redaction', () => {
  const SECRETS = ['sk-secret', 'Bearer', 'hooks.example', 'mcp.example', 'API_KEY_VALUE'];
  const free = (answer: PluginManifestView) => {
    const text = JSON.stringify(answer);
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
  };

  it('a malformed .mcp.json whose broken line holds a secret answers `not valid JSON` and nothing of the file', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p' }, '.mcp.json': '{"mcpServers": {"x": {"env": {"K": sk-secret-123}}}}' });
    const answer = await view({ root: plugin });
    expect(answer.problems).toEqual(['.mcp.json: not valid JSON']);
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
    expect(JSON.stringify(answer)).not.toContain('Unexpected token');
  });

  it('a malformed plugin.json and marketplace.json say so in the fixed words, nothing of the file', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': '{"name": "p", "token": sk-secret-manifest' });
    const marketplace = await tree(join(root, 'mk'), { '.claude-plugin/marketplace.json': '{"plugins": [sk-secret-market' });
    const answer = await view({ root: plugin, marketplaceRoot: marketplace });
    expect(answer.problems).toEqual(['.claude-plugin/marketplace.json: not valid JSON', '.claude-plugin/plugin.json: not valid JSON']);
    free(answer);
  });

  it('no MCP command, argument, environment, header or URL; no hook, monitor or LSP command; no userConfig value', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', userConfig: { API: { type: 'string', title: 'API', description: 'Key', default: 'sk-secret-default', sensitive: true } } },
      '.mcp.json': { mcpServers: {
        stdio: { command: 'sk-secret-cmd', args: ['--token', 'sk-secret-arg'], env: { API_KEY: 'API_KEY_VALUE sk-secret-env' } },
        remote: { type: 'http', url: 'https://mcp.example.com/mcp?token=sk-secret-url', headers: { Authorization: 'Bearer sk-secret-header' } },
      } },
      'hooks/hooks.json': { hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'curl -H "Authorization: Bearer sk-secret-hook" https://hooks.example.com' }] }] } },
      'monitors/monitors.json': [{ name: 'tail', command: 'tail sk-secret-monitor', description: 'Tails the log' }],
      '.lsp.json': { ts: { command: 'sk-secret-lsp', env: { TOKEN: 'sk-secret-lsp-env' }, extensionToLanguage: { '.ts': 'typescript' } } },
    });
    const answer = await view({ root: plugin });
    expect(answer.problems).toEqual([]);
    expect(names(answer.components.mcpServers)).toEqual(['stdio', 'remote']);
    expect(answer.components.hooks).toEqual([{ event: 'PostToolUse', matcher: 'Write' }]);
    expect(answer.components.monitors).toEqual([{ name: 'tail', description: 'Tails the log' }]);
    free(answer);
  });

  it('a URL where a path is declared is `unknown shape` under the declaring file, never echoed (monitors, a command map’s source, skills)', async () => {
    const url = 'https://monitor.example/config?token=sk-secret-review';
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', monitors: url, commands: { remote: { source: url } }, skills: [url], hooks: url, lspServers: url },
    });
    const recorded = recording();
    const answer = await view({ root: plugin }, INSTALLATION, { fs: recorded.fs });
    expect(answer.problems).toEqual(['.claude-plugin/plugin.json: unknown shape']);
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
    expect(JSON.stringify(answer)).not.toContain('monitor.example');
    expect(recorded.touched().filter((path) => path.includes('monitor.example'))).toEqual([]);
  });

  it('a file that cannot be read says `could not be read`, never the error’s message', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p' }, '.mcp.json': { mcpServers: {} } });
    const failing: ManifestReaderDeps['fs'] = {
      ...fsp,
      open: (async (path: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
        if (String(path).endsWith('.mcp.json')) throw Object.assign(new Error('EACCES: permission denied, open sk-secret-errno'), { code: 'EACCES' });
        return (fsp.open as (...a: unknown[]) => unknown)(path, ...rest);
      }) as typeof fsp.open,
    };
    const answer = await view({ root: plugin }, INSTALLATION, { fs: failing });
    expect(answer.problems).toEqual(['.mcp.json: could not be read']);
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
  });
});

describe('the anchors', () => {
  it('an absent anchor directory is `missing` (an uninstall in flight); no root is `unknown`', async () => {
    expect(await view({ root: join(root, 'gone') })).toMatchObject({ state: 'missing', name: null, partial: false });
    expect(await view({ root: null })).toMatchObject({ state: 'unknown', name: null });
  });

  it('an anchor that is a file, not a directory, is `unknown`', async () => {
    await writeFile(join(root, 'file'), 'x');
    expect((await view({ root: join(root, 'file') })).state).toBe('unknown');
  });

  it('a missing plugin.json is not `missing`', async () => {
    const plugin = await tree(join(root, 'p'), { 'README.md': 'x' });
    expect((await view({ root: plugin })).state).toBe('read');
  });
});

describe('an available entry', () => {
  const AVAILABLE: ManifestItemRef = { kind: 'available', pluginId: 'p@m' };

  it('with a relative source, reads the entry and its files inside the marketplace’s clone', async () => {
    const marketplace = await tree(join(root, 'mk'), {
      ...market([{ name: 'p', source: './plugins/p', description: 'Entry words', version: '0.3.0', author: { name: 'Maker' } }]),
      'plugins/p/.claude-plugin/plugin.json': { name: 'p', version: '0.3.0' },
      'plugins/p/skills/s/SKILL.md': md({ name: 's', description: 'A skill' }),
    });
    const answer = await view({ marketplaceRoot: marketplace }, AVAILABLE);
    expect(answer).toMatchObject({ key: AVAILABLE, state: 'read', name: 'p', version: '0.3.0', marketplaceVersion: '0.3.0', description: 'Entry words', author: 'Maker' });
    expect(answer.components.skills).toEqual([{ name: 's', description: 'A skill' }]);
  });

  it('with a source not on disk (a subdirectory of another repository, a URL), answers the entry with no inventory', async () => {
    const marketplace = await tree(join(root, 'mk'), market([
      { name: 'p', description: 'Elsewhere', source: { source: 'git-subdir', url: 'https://example.com/r', path: 'plugins/p' } },
      { name: 'u', source: { source: 'url', url: 'https://example.com/u.git' } },
    ]));
    const answer = await view({ marketplaceRoot: marketplace }, AVAILABLE, { fs: spy(['example.com']) });
    expect(answer).toMatchObject({ state: 'read', name: 'p', description: 'Elsewhere', problems: [] });
    expect(Object.values(answer.components).every((v) => (Array.isArray(v) ? v.length === 0 : v === 0))).toBe(true);
  });

  it('a string source that is a URL is `unknown shape` under marketplace.json, never echoed or read', async () => {
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'p', description: 'Remote', source: 'https://example.com/p.git?token=sk-secret-source' }]));
    const answer = await view({ marketplaceRoot: marketplace }, AVAILABLE);
    expect(answer).toMatchObject({ state: 'read', description: 'Remote', problems: ['.claude-plugin/marketplace.json: unknown shape'] });
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
  });

  it('a relative source that climbs out of the marketplace is `outside the plugin`', async () => {
    await tree(join(root, 'secret'), { '.claude-plugin/plugin.json': { name: 'p', description: 'sk-secret-climb' } });
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'p', source: '../secret' }]));
    const answer = await view({ marketplaceRoot: marketplace }, AVAILABLE);
    expect(answer.problems).toEqual(['.claude-plugin/marketplace.json: outside the plugin']);
    expect(JSON.stringify(answer)).not.toContain('sk-secret');
  });

  it('is `unknown` with no marketplace, or when the marketplace lists no such entry; `missing` when its clone is gone', async () => {
    expect((await view({ marketplaceRoot: null }, AVAILABLE)).state).toBe('unknown');
    const marketplace = await tree(join(root, 'mk'), market([{ name: 'other', source: './o' }]));
    expect((await view({ marketplaceRoot: marketplace }, AVAILABLE)).state).toBe('unknown');
    expect((await view({ marketplaceRoot: join(root, 'gone') }, AVAILABLE)).state).toBe('missing');
  });
});

describe('the bounds', () => {
  it('past 200 items of one kind the view is partial with the first 200', async () => {
    const files: Tree = { '.claude-plugin/plugin.json': { name: 'p' } };
    for (let i = 0; i < 205; i += 1) files[`commands/c${String(i).padStart(3, '0')}.md`] = md({ description: `C${i}` });
    const answer = await view({ root: await tree(join(root, 'p'), files) });
    expect(answer.partial).toBe(true);
    expect(answer.components.commands).toHaveLength(200);
  });

  it('past 1,000 files of one plugin the view is partial, and scanning stopped there', async () => {
    const files: Tree = { '.claude-plugin/plugin.json': { name: 'p' } };
    for (let i = 0; i < 1005; i += 1) files[`commands/notes/n${String(i).padStart(4, '0')}.txt`] = 'x';
    const recorded = recording();
    const answer = await view({ root: await tree(join(root, 'p'), files) }, INSTALLATION, { fs: recorded.fs });
    expect(answer.partial).toBe(true);
    expect(recorded.resolved()).toBeLessThanOrEqual(1_000); // no entry past the bound was even resolved
    expect(recorded.touched().some((path) => path.endsWith('n1004.txt'))).toBe(false);
  });

  it('MCP bundles and hook modules are bounded like items: 200 is complete, 201 is partial at 200', async () => {
    const bundles = (n: number) => tree(join(root, `b${n}`), { '.claude-plugin/plugin.json': { name: 'p', mcpServers: Array.from({ length: n }, (_, i) => `./b${i}.mcpb`) } });
    const modules = (n: number) => tree(join(root, `m${n}`), { '.claude-plugin/plugin.json': { name: 'p' }, 'hooks/hooks.json': { modules: Array.from({ length: n }, (_, i) => `./m${i}.ts`) } });
    expect(await view({ root: await bundles(200) })).toMatchObject({ partial: false, components: { mcpBundles: 200 } });
    expect(await view({ root: await bundles(201) })).toMatchObject({ partial: true, components: { mcpBundles: 200 } });
    expect(await view({ root: await modules(200) })).toMatchObject({ partial: false, components: { hookModules: 200 } });
    expect(await view({ root: await modules(201) })).toMatchObject({ partial: true, components: { hookModules: 200 } });
  });

  it('hook modules that are not a list of paths are `unknown shape`, never counted (a number, a map, a string, a non-path entry)', async () => {
    for (const [i, modules] of ([42, { a: './m.ts' }, './m.ts', ['./m.ts', 42]] as unknown[]).entries()) {
      const answer = await view({ root: await tree(join(root, `odd${i}`), { '.claude-plugin/plugin.json': { name: 'p' }, 'hooks/hooks.json': { modules } }) });
      expect(answer.problems).toEqual(['hooks/hooks.json: unknown shape']);
      expect(answer.components.hookModules).toBe(Array.isArray(modules) ? 1 : 0);
    }
  });

  it('a filesystem call that stalls past the deadline ends the read: partial, at once, no message', async () => {
    const stalled = { ...fsp, realpath: (async () => new Promise<string>(() => undefined)) as unknown as typeof fsp.realpath };
    const started = Date.now();
    const answer = await view({ root: '/stalled' }, INSTALLATION, { fs: stalled, deadline: Date.now() + 30 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(answer).toMatchObject({ state: 'unknown', partial: true, problems: [] });
  });

  it('a read that stalls mid-file ends at the deadline with what was read, and its file handle is closed', async () => {
    const plugin = await tree(join(root, 'p'), {
      '.claude-plugin/plugin.json': { name: 'p', description: 'Read before the stall' },
      '.mcp.json': { mcpServers: { s: { command: 'x' } } },
      'commands/slow.md': md({ description: 'Never finishes' }),
    });
    let closed = 0;
    const slow: ManifestReaderDeps['fs'] = {
      ...fsp,
      open: (async (path: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
        const handle = (await (fsp.open as (...a: unknown[]) => Promise<FileHandle>)(path, ...rest)) as FileHandle;
        const stall = String(path).endsWith('slow.md');
        return { read: stall ? () => new Promise(() => undefined) : handle.read.bind(handle), stat: () => handle.stat(), close: async () => ((closed += 1), handle.close()) } as unknown as FileHandle;
      }) as typeof fsp.open,
    };
    const started = Date.now();
    const answer = await view({ root: plugin }, INSTALLATION, { fs: slow, deadline: Date.now() + 300 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(answer).toMatchObject({ state: 'read', partial: true, description: 'Read before the stall', components: { mcpServers: [{ name: 's', transport: 'stdio' }], commands: [] } });
    expect(answer.problems).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(4); // plugin.json, .mcp.json, the commands folder listed (F-AB) and the stalled file's handle
  });

  it('past the call’s deadline the view is partial with what it read; one begun past it reads nothing', async () => {
    const plugin = await tree(join(root, 'p'), { '.claude-plugin/plugin.json': { name: 'p', description: 'Read' }, 'commands/a.md': md({ description: 'A' }) });
    let clock = 0;
    const late = await view({ root: plugin }, INSTALLATION, { now: () => (clock += 1), deadline: 6 });
    expect(late).toMatchObject({ partial: true });
    const never = await view({ root: plugin }, INSTALLATION, { now: () => 100, deadline: 50 });
    expect(never).toMatchObject({ state: 'unknown', partial: true, name: null });
  });
});

// The real fs, recording every path it resolved, stated or opened and the bytes each file handle read.
function recording() {
  const touched: string[] = [];
  const bytes = new Map<string, number>();
  const resolved = new Set<string>(); // the distinct paths resolved (P2-F L136: a file read is resolved again after its open)
  const fs: ManifestReaderDeps['fs'] = {
    ...fsp,
    realpath: (async (path: Parameters<typeof fsp.realpath>[0], ...rest: unknown[]) => {
      resolved.add(String(path));
      touched.push(String(path));
      return (fsp.realpath as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fsp.realpath,
    lstat: (async (path: Parameters<typeof fsp.lstat>[0], ...rest: unknown[]) => {
      touched.push(String(path));
      return (fsp.lstat as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fsp.lstat,
    open: (async (path: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
      touched.push(String(path));
      const handle = (await (fsp.open as (...a: unknown[]) => Promise<FileHandle>)(path, ...rest)) as FileHandle;
      return {
        read: async (...args: unknown[]) => {
          const result = await (handle.read as (...a: unknown[]) => Promise<{ bytesRead: number }>)(...args);
          bytes.set(String(path), (bytes.get(String(path)) ?? 0) + result.bytesRead);
          return result;
        },
        stat: () => handle.stat(),
        close: () => handle.close(),
      } as unknown as FileHandle;
    }) as typeof fsp.open,
  };
  return { fs, touched: () => touched, resolved: () => resolved.size, bytesOf: (suffix: string) => [...bytes].filter(([path]) => path.endsWith(suffix)).reduce((n, [, b]) => n + b, 0) };
}

// The real fs, refusing any path that contains one of `forbidden` (proves a bundle, module or URL is never opened).
function spy(forbidden: string[]): ManifestReaderDeps['fs'] {
  const guard = (path: unknown) => {
    if (forbidden.some((part) => String(path).includes(part))) throw new Error(`read ${String(path)}`);
  };
  return {
    ...fsp,
    open: (async (path: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
      guard(path);
      return (fsp.open as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fsp.open,
    readFile: (async (path: Parameters<typeof fsp.readFile>[0], ...rest: unknown[]) => {
      guard(path);
      return (fsp.readFile as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fsp.readFile,
    lstat: (async (path: Parameters<typeof fsp.lstat>[0], ...rest: unknown[]) => {
      guard(path);
      return (fsp.lstat as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fsp.lstat,
  };
}
