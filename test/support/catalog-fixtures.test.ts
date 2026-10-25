// P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M1 Touches): the recorded catalog sources
// (e2e/fixtures/catalog, written by scripts/catalog-fixtures.mjs) hold every case the acceptance runs against, so a
// re-recording that loses one fails here rather than in the Mac group.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../e2e/fixtures/catalog');
type Page = Record<string, unknown>;
const source = (key: string) => {
  const file = JSON.parse(readFileSync(join(DIR, `${key}.json`), 'utf8')) as { key: string; recordedAt: string; pages: Page[] };
  expect(file.key).toBe(key);
  return file.pages;
};
interface Entry { name: string; source: string | { source: string; url?: string; repo?: string; path?: string; sha?: string }; author?: { name: string } }
interface DirectoryRecord { name: string; verified_tier: string; surfaces?: string[]; components?: unknown[]; _fixture?: string; checks: { scan: { state: string; assessment?: string } }; source: { repository: { url: string; path?: string; reviewed_commit?: string } } }
interface Server { display_name: string; type: string; works_with?: string[]; remote?: { url: string | null; url_regex: string | null; transport: string; auth_posture: string } }
const manifest = (name: string) => source(`seed:${name}`)[0] as { name: string; plugins: Entry[] };
const repository = (url: string) => {
  const u = (/^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url).toLowerCase().replace(/\/+$/, '');
  return u.endsWith('.git') ? u.slice(0, -4) : u;
};
const path = (p?: string) => (p ?? '').replace(/^\.\/?/, '').replace(/^\/+|\/+$/g, '');
const identity = (entry: Entry, repo: string) => (typeof entry.source === 'string' ? `${repository(repo)}#${path(entry.source)}` : `${repository(entry.source.url ?? entry.source.repo!)}#${path(entry.source.path)}`);
const records = () => source('directory:plugins')[0]!.data as DirectoryRecord[];

const SEEDS = ['claude-plugins-official', 'claude-community', 'anthropic-agent-skills', 'claude-for-financial-services', 'knowledge-work-plugins', 'claude-for-legal', 'life-sciences', 'k12-teacher-skills', 'claude-for-financial-advisors', 'notion-plugin-marketplace', 'canva-skills', 'carta-plugins'];

describe('the recorded catalog sources', () => {
  it('are one file per network source key, the local test marketplace and the synthetic icon', () => {
    expect(readdirSync(DIR).sort()).toEqual(['directory:plugins.json', 'directory:servers.json', 'icons', 'marketplace', 'plugin-details.json', ...SEEDS.map((name) => `seed:${name}.json`)].sort());
    for (const name of SEEDS) expect(manifest(name).name).toBe(name);
  });

  it('give the shelves something to show: seeds with more than one plugin, Anthropic-listed counts for Featured', () => {
    for (const name of ['claude-plugins-official', 'claude-for-financial-services', 'claude-for-legal']) expect(manifest(name).plugins.length).toBeGreaterThan(1);
    const details = source('plugin-details')[0] as { plugins: Record<string, { unique_installs?: number; last_updated: string }> };
    const official = new Set(manifest('claude-plugins-official').plugins.map((entry) => `${entry.name}@claude-plugins-official`));
    expect(Object.keys(details.plugins).sort()).toEqual([...official].sort());
    expect(Object.values(details.plugins).filter((plugin) => (plugin.unique_installs ?? 0) > 0).length).toBeGreaterThan(1);
    const dates = Object.values(details.plugins).map((plugin) => plugin.last_updated);
    expect(dates.length - new Set(dates).size).toBeGreaterThan(0); // equal `updatedAt`s, for the sort across a tie
  });

  it('hold a pair that joins at different refs, a same-name pair that must not, and a renamed item', () => {
    const official = manifest('claude-plugins-official').plugins;
    const community = manifest('claude-community').plugins;
    const joined = official.filter((entry) => community.some((other) => identity(other, 'anthropics/claude-plugins-community') === identity(entry, 'anthropics/claude-plugins-official')));
    expect(joined.some((entry) => {
      const other = community.find((c) => identity(c, 'anthropics/claude-plugins-community') === identity(entry, 'anthropics/claude-plugins-official'))!;
      return typeof entry.source === 'object' && typeof other.source === 'object' && entry.source.sha !== other.source.sha;
    })).toBe(true);
    expect(official.some((entry) => community.some((other) => other.name === entry.name && identity(other, 'anthropics/claude-plugins-community') !== identity(entry, 'anthropics/claude-plugins-official')))).toBe(true);
    const adobe = official.find((entry) => entry.name === 'adobe-for-creativity')!;
    expect(records().find((record) => record.name === 'Adobe')).toBeDefined();
    expect(records().some((record) => record.name === 'Adobe' && `${repository(record.source.repository.url)}#${path(record.source.repository.path)}` === identity(adobe, 'anthropics/claude-plugins-official'))).toBe(true);
  });

  it('hold the directory’s cases: each tier, no components, another surface, and the two synthetic records', () => {
    const all = records();
    for (const tier of ['anthropic', 'partner', 'community']) expect(all.some((record) => record.verified_tier === tier)).toBe(true);
    expect(all.some((record) => (record.components ?? []).length === 0 && record._fixture === undefined)).toBe(true);
    expect(all.some((record) => !(record.surfaces ?? []).includes('claude_code'))).toBe(true);
    const synthetic = all.filter((record) => record._fixture !== undefined);
    expect(synthetic.map((record) => record._fixture!.split(':')[0])).toEqual(['synthetic', 'synthetic']);
    expect(synthetic.some((record) => record.checks.scan.state === 'ready' && record.checks.scan.assessment === 'fail')).toBe(true);
    expect(synthetic.some((record) => record.source.repository.reviewed_commit === undefined)).toBe(true);
    expect(all.filter((record) => record._fixture === undefined).every((record) => /^[0-9a-f]{40}$/.test(record.source.repository.reviewed_commit ?? ''))).toBe(true);
  });

  it('hold the servers’ cases over two pages: Linear, an instance URL, authless, sse, a desktop extension, not for Claude Code', () => {
    const pages = source('directory:servers') as { servers: Server[]; next_cursor: string | null }[];
    expect(pages.map((page) => page.next_cursor === null)).toEqual([false, true]);
    const servers = pages.flatMap((page) => page.servers);
    const forCode = (s: Server) => s.type === 'remote' && (s.works_with ?? []).includes('claude-code');
    expect(servers.find((s) => s.display_name === 'Linear')).toMatchObject({ type: 'remote', remote: { url: 'https://mcp.linear.app/mcp', transport: 'streamable-http', auth_posture: 'auth_required' } });
    expect(servers.some((s) => forCode(s) && s.remote!.url === null && s.remote!.url_regex !== null)).toBe(true);
    expect(servers.some((s) => forCode(s) && s.remote!.auth_posture === 'no_auth')).toBe(true);
    expect(servers.some((s) => forCode(s) && s.remote!.transport === 'sse')).toBe(true);
    expect(servers.some((s) => s.type === 'local')).toBe(true);
    expect(servers.some((s) => s.type === 'remote' && !(s.works_with ?? []).includes('claude-code'))).toBe(true);
  });

  it('give the local test marketplace four plugins with authors, one of each kind of content', () => {
    const local = JSON.parse(readFileSync(join(DIR, 'marketplace', '.claude-plugin', 'marketplace.json'), 'utf8')) as { name: string; plugins: Entry[] };
    expect(local.name).toBe('maws-discover-test');
    expect(local.plugins.map((entry) => [entry.name, typeof entry.author?.name])).toEqual([['hooked', 'string'], ['local-server', 'string'], ['remote-server', 'string'], ['skills-only', 'string']]);
  });
});
