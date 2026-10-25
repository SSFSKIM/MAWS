// Records the Discover catalog's fixtures (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M1), so they
// can be re-recorded when the sources change shape:
//
//   node scripts/catalog-fixtures.mjs network [--out e2e/fixtures/catalog]
//     Walks the network sources the catalog reads (GET only, no credentials) and writes one trimmed file per source key
//     (`seed:<marketplace name>`, `directory:plugins`, `directory:servers`, `plugin-details`), each
//     `{key, recordedAt, pages: [<the response body as served, trimmed>, ...]}`: one page for a single document, the walk's
//     pages in order for a paged source (the servers' trimmed records are split over two pages linked by `next_cursor`, so
//     the catalog's cursor walk is exercised offline). The selection is by rule, below, so a re-recording picks the same
//     kinds of record from whatever the sources hold that day; a rule that finds nothing fails the recording by name.
//
//   node scripts/catalog-fixtures.mjs engine [--engine <binary>] [--out test/fixtures/catalog]
//     Runs the unmodified engine in a scratch HOME and CLAUDE_CONFIG_DIR under /tmp (removed after), with its Anthropic
//     Directory turned off, the test marketplace (e2e/fixtures/catalog/marketplace) and a second local marketplace of
//     pinned remote entries added, `skills-only` installed for the user and `remote-server` for a project, and records the
//     CLI's own JSON (`plugin list --json --available`, `plugin list --json`, `plugin marketplace list --json`) with the
//     scratch root written `<scratch>`: the inputs M2's engine-host reducers parse. Unit tests only; the e2e harness never
//     reads them.
//
// Records are trimmed, never rewritten, except two synthetic directory records marked `_fixture` (no live record fails
// a scan or lacks its reviewed commit today) and the servers' pagination fields.
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const { fetch } = globalThis;
const clone = (value) => deserialize(serialize(value));
const USER_AGENT = 'MAWS/0.0.0 (catalog fixtures; https://github.com/SSFSKIM/MAWS)';
const DIRECTORY = 'https://api.anthropic.com/api/directory';
const PLUGIN_DETAILS = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json';

// The spec's twelve general seeds, in its table's order (fact 1; the owner's doperpowers and cua are not seeds, 1a).
const SEEDS = [
  ['anthropics/claude-plugins-official', 'claude-plugins-official'],
  ['anthropics/claude-plugins-community', 'claude-community'],
  ['anthropics/skills', 'anthropic-agent-skills'],
  ['anthropics/financial-services', 'claude-for-financial-services'],
  ['anthropics/knowledge-work-plugins', 'knowledge-work-plugins'],
  ['anthropics/claude-for-legal', 'claude-for-legal'],
  ['anthropics/life-sciences', 'life-sciences'],
  ['anthropics/k12-teacher-skills', 'k12-teacher-skills'],
  ['anthropics/claude-for-financial-advisors', 'claude-for-financial-advisors'],
  ['makenotion/claude-code-notion-plugin', 'notion-plugin-marketplace'],
  ['canva-sdks/canva-skills', 'canva-skills'],
  ['carta/plugins', 'carta-plugins'],
];
// The seeds sliced rather than kept whole: the three large manifests.
const SLICED = new Set(['claude-plugins-official', 'claude-community', 'knowledge-work-plugins']);

// ---- identity (the spec's "One item per thing": repository and path, refs ignored) -------------------------------

function normalizeRepository(url) {
  let u = String(url).trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`; // the community manifest's `owner/repo` shorthand
  u = u.toLowerCase().replace(/\/+$/, '');
  return u.endsWith('.git') ? u.slice(0, -4) : u;
}
const normalizePath = (path) => String(path ?? '').replace(/^\.\/?/, '').replace(/^\/+|\/+$/g, '');

// A manifest entry's (repository, path); `repo` is the marketplace's own repository, for relative sources.
function entryIdentity(entry, repo) {
  const s = entry.source;
  if (typeof s === 'string') return `${normalizeRepository(repo)}#${normalizePath(s)}`;
  if (s.source === 'github') return `${normalizeRepository(s.repo)}#${normalizePath(s.path)}`;
  return `${normalizeRepository(s.url ?? s.repo)}#${normalizePath(s.path)}`;
}
const recordIdentity = (record) => `${normalizeRepository(record.source.repository.url)}#${normalizePath(record.source.repository.path)}`;

// ---- network ------------------------------------------------------------------------------------------------------

async function get(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return response.json();
}

async function walkPlugins() {
  const pages = [];
  let page = null;
  do {
    const body = await get(`${DIRECTORY}/plugins?visibility=public&limit=5000${page ? `&page=${encodeURIComponent(page)}` : ''}`);
    pages.push(body);
    page = body.next_page ?? null;
  } while (page);
  return pages;
}

async function walkServers() {
  const pages = [];
  let cursor = null;
  do {
    const body = await get(`${DIRECTORY}/servers?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    pages.push(body);
    cursor = body.next_cursor ?? null;
  } while (cursor);
  return pages;
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
function need(value, what) {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) throw new Error(`no record for the rule: ${what}`);
  return value;
}
const worksInClaudeCode = (server) => server.type === 'remote' && (server.works_with ?? []).includes('claude-code');

// Picks what the fixtures keep (the spec's M1 list; the comments name the acceptance item each pick serves).
function select({ manifests, plugins, servers, details }) {
  const official = manifests.get('claude-plugins-official');
  const community = manifests.get('claude-community');
  const officialRepo = 'anthropics/claude-plugins-official';
  const communityRepo = 'anthropics/claude-plugins-community';
  const officialIds = new Map(official.plugins.map((entry) => [entryIdentity(entry, officialRepo), entry]));
  const communityIds = new Map(community.plugins.map((entry) => [entryIdentity(entry, communityRepo), entry]));
  const directoryIds = new Map(plugins.map((record) => [recordIdentity(record), record]));
  const installs = (name) => details.plugins[`${name}@claude-plugins-official`]?.unique_installs ?? 0;

  const officialPicks = new Set();
  const communityPicks = new Set();
  // Featured and the official shelf: the ten most installed official plugins (they hold two natural equal
  // `last_updated` pairs today, code-review and code-simplifier, github and playwright; acceptance 1 and 6).
  for (const entry of [...official.plugins].sort((a, b) => installs(b.name) - installs(a.name) || byName(a, b)).slice(0, 10)) officialPicks.add(entry.name);
  // The official-and-community pair at different refs, partner-tier in the directory (acceptance 2: one card, "Also
  // listed by claude-community"; M2: a pair at different refs that must join).
  const pair = need(
    official.plugins.filter((entry) => typeof entry.source === 'object' && entry.source.sha).find((entry) => {
      const id = entryIdentity(entry, officialRepo);
      const other = communityIds.get(id);
      return other && typeof other.source === 'object' && other.source.sha && other.source.sha !== entry.source.sha && directoryIds.get(id)?.verified_tier === 'partner';
    }),
    'an official entry the community manifest lists at another sha, partner in the directory',
  );
  officialPicks.add(pair.name);
  communityPicks.add(communityIds.get(entryIdentity(pair, officialRepo)).name);
  // The same-name pair: an official plugin and a community plugin of one name from different repositories (acceptance
  // 2: two cards). No "github" pair exists today; the first such name, by name, among the installed-most official ones.
  const sameName = need(
    [...official.plugins].sort((a, b) => installs(b.name) - installs(a.name) || byName(a, b)).find((entry) => community.plugins.some((other) => other.name === entry.name && entryIdentity(other, communityRepo) !== entryIdentity(entry, officialRepo))),
    'an official plugin whose name a community plugin from another repository shares',
  );
  officialPicks.add(sameName.name);
  communityPicks.add(sameName.name);
  // A display name unlike its install name (acceptance 2: "Adobe" and adobe-for-creativity).
  officialPicks.add(need(official.plugins.find((entry) => entry.name === 'adobe-for-creativity'), 'adobe-for-creativity in the official manifest').name);
  // Community items: one the directory knows at its community tier (search and the Community label), and a remote one
  // nobody describes (unknown contents: "Contents shown after install"; acceptance 3).
  const sortedCommunity = [...community.plugins].sort(byName);
  communityPicks.add(need(sortedCommunity.find((entry) => directoryIds.get(entryIdentity(entry, communityRepo))?.verified_tier === 'community' && !officialIds.has(entryIdentity(entry, communityRepo))), 'a community entry the directory lists at its community tier').name);
  communityPicks.add(need(sortedCommunity.find((entry) => typeof entry.source === 'object' && entry.source.source === 'url' && !directoryIds.has(entryIdentity(entry, communityRepo)) && !officialIds.has(entryIdentity(entry, communityRepo))), 'a remote community entry the directory does not know').name);

  const knowledge = manifests.get('knowledge-work-plugins');
  const knowledgePicks = new Set([...knowledge.plugins].sort(byName).slice(0, 6).map((entry) => entry.name));

  const trimmedManifests = new Map();
  for (const [repo, name] of SEEDS) {
    const manifest = manifests.get(name);
    const keep = name === 'claude-plugins-official' ? officialPicks : name === 'claude-community' ? communityPicks : name === 'knowledge-work-plugins' ? knowledgePicks : null;
    trimmedManifests.set(name, { repo, body: keep ? { ...manifest, plugins: manifest.plugins.filter((entry) => keep.has(entry.name)) } : manifest });
  }

  // Directory plugins: every record a kept manifest entry joins, then the directory-only cases.
  const kept = new Set();
  for (const { repo, body } of trimmedManifests.values()) for (const entry of body.plugins) kept.add(entryIdentity(entry, repo));
  const records = plugins.filter((record) => kept.has(recordIdentity(record)));
  const notKept = plugins.filter((record) => !kept.has(recordIdentity(record))).sort((a, b) => (a.id < b.id ? -1 : 1));
  const hasAxis = (record) => record.taxonomy?.object_acted_on !== undefined;
  records.push(need(notKept.find((record) => record.verified_tier === 'community' && (record.components ?? []).length > 0 && hasAxis(record) && (record.surfaces ?? []).includes('claude_code')), 'a directory-only community record'));
  records.push(need(notKept.find((record) => record.verified_tier === 'partner' && (record.components ?? []).length > 0 && hasAxis(record)), 'a directory-only partner record'));
  records.push(need(notKept.find((record) => (record.components ?? []).length === 0 && (record.surfaces ?? []).includes('claude_code')), 'a directory record listing no components'));
  records.push(need(notKept.find((record) => !(record.surfaces ?? []).includes('claude_code')), 'a directory record not offered for Claude Code'));
  // Synthetic, marked: no live record fails a scan (fact 3), and every public record carries a reviewed commit today.
  const base = need(notKept.find((record) => record.verified_tier === 'community' && (record.components ?? []).length > 0 && hasAxis(record) && !records.includes(record)), 'a community record to base the synthetic ones on');
  const synthetic = (suffix, change) => ({ ...clone(base), id: `fixture-${suffix}`, slug: `fixture-${suffix}`, name: `Fixture ${suffix.replace(/-/g, ' ')}`, manifest_name: `fixture-${suffix}`, ...change });
  const failed = synthetic('failed-scan', { _fixture: 'synthetic: a failed security scan; no live record fails one (spec fact 3). The shape is Desktop\'s scan `ready` with assessment `fail` (claude-desktop-re app-3.6556.2 c310cdd26-CSnNH8yH.js 430 to 450).' });
  failed.checks = { ...failed.checks, scan: { state: 'ready', assessment: 'fail', reason: 'Fixture: the scan found a component that sends data it does not declare.', secondary_reasons: [] } };
  failed.source = { ...failed.source, repository: { ...failed.source.repository, url: 'https://github.com/maws-fixtures/failed-scan', path: undefined } };
  const unpinned = synthetic('no-reviewed-commit', { _fixture: 'synthetic: a record without `reviewed_commit`, which the engine skips as `no_pin` (spec fact 2); every public record carries one today.' });
  unpinned.source = { ...unpinned.source, repository: { url: 'https://github.com/maws-fixtures/no-reviewed-commit' } };
  records.push(failed, unpinned);

  // Servers: Linear and one of each case (acceptance 8), and the most popular few (Featured, shelves, ranks).
  const claudeCode = servers.filter(worksInClaudeCode);
  const rank = (s) => s.popularity_rank ?? Number.MAX_SAFE_INTEGER;
  const serverPicks = new Map();
  const pick = (server) => serverPicks.set(server.id, server);
  pick(need(servers.find((s) => s.display_name === 'Linear' && worksInClaudeCode(s)), 'Linear, remote, for Claude Code'));
  for (const s of [...claudeCode].sort((a, b) => rank(a) - rank(b)).slice(0, 6)) pick(s);
  pick(need([...claudeCode].sort((a, b) => rank(a) - rank(b)).find((s) => s.remote?.url === null && s.remote?.url_regex), 'a server taking an instance URL (url_regex)'));
  pick(need([...claudeCode].sort((a, b) => rank(a) - rank(b)).find((s) => s.remote?.auth_posture === 'no_auth'), 'an authless server'));
  pick(need([...claudeCode].sort((a, b) => rank(a) - rank(b)).find((s) => s.remote?.transport === 'sse'), 'an sse server'));
  pick(need([...servers].sort((a, b) => rank(a) - rank(b)).find((s) => s.type === 'local'), 'a local desktop extension'));
  pick(need([...servers].sort((a, b) => rank(a) - rank(b)).find((s) => s.type === 'remote' && !(s.works_with ?? []).includes('claude-code')), 'a remote server not for Claude Code'));
  const keptServers = [...serverPicks.values()];

  const officialIdsKept = new Set([...officialPicks].map((name) => `${name}@claude-plugins-official`));
  const keptDetails = { ...details, plugins: Object.fromEntries(Object.entries(details.plugins).filter(([id]) => officialIdsKept.has(id))) };
  return { manifests: trimmedManifests, records, servers: keptServers, details: keptDetails };
}

async function recordNetwork(out) {
  const recordedAt = new Date().toISOString();
  const manifests = new Map();
  for (const [repo, name] of SEEDS) {
    const body = await get(`https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`);
    if (body.name !== name) throw new Error(`${repo}'s marketplace is named ${body.name}, not ${name}: the seed list is stale`);
    manifests.set(name, body);
  }
  const pluginPages = await walkPlugins();
  const serverPages = await walkServers();
  const details = await get(PLUGIN_DETAILS);
  const chosen = select({ manifests, plugins: pluginPages.flatMap((page) => page.data), servers: serverPages.flatMap((page) => page.servers), details });

  mkdirSync(out, { recursive: true });
  const write = (key, pages) => writeFileSync(join(out, `${key}.json`), `${JSON.stringify({ key, recordedAt, pages }, null, 2)}\n`);
  for (const [name, { body }] of chosen.manifests) write(`seed:${name}`, [body]);
  write('directory:plugins', [{ ...pluginPages[0], data: chosen.records, facets: {}, omitted: [] }]);
  const half = Math.ceil(chosen.servers.length / 2);
  const total = chosen.servers.length;
  write('directory:servers', [
    { servers: chosen.servers.slice(0, half), total, next_cursor: 'fixture-page-2', stale_feeds: serverPages[0].stale_feeds ?? [] },
    { servers: chosen.servers.slice(half), total, next_cursor: null, stale_feeds: serverPages.at(-1).stale_feeds ?? [] },
  ]);
  write('plugin-details', [chosen.details]);
  const counts = [...chosen.manifests].map(([name, { body }]) => `${name} ${body.plugins.length}${SLICED.has(name) ? ' (slice)' : ''}`);
  console.log(`recorded ${recordedAt} into ${out}: ${counts.join(', ')}; directory:plugins ${chosen.records.length}; directory:servers ${total}; plugin-details ${Object.keys(chosen.details.plugins).length}`);
}

// ---- engine -------------------------------------------------------------------------------------------------------

// A second local marketplace whose entries pin remote sources by sha and ref, so the recorded listing carries them
// (the engine lists an entry without fetching it).
const PINNED = {
  name: 'maws-recorded-pins',
  owner: { name: 'MAWS recordings', email: 'recordings@example.invalid' },
  plugins: [
    { name: 'expo', description: 'A git-subdir entry pinned by ref and sha', author: { name: 'Expo' }, source: { source: 'git-subdir', url: 'https://github.com/expo/skills.git', path: 'plugins/expo', ref: 'main', sha: 'd4f484024fec15196bfd3c272e953e3f983972cf' } },
    { name: 'skill-creator', description: 'A url entry pinned by sha', source: { source: 'url', url: 'https://github.com/aisa-one/skill-creator.git', sha: 'fdd5600fc154187b02af53fbcb10bf50b84a1684' } },
    { name: 'notion-workspace-plugin', description: 'A github entry with a ref only', source: { source: 'github', repo: 'makenotion/claude-code-notion-plugin', ref: 'main' } },
  ],
};

function recordEngine(out, engine) {
  const root = realpathSync(mkdtempSync('/tmp/maws-catalog-record-'));
  try {
    const home = join(root, 'home');
    const config = join(root, 'config');
    const project = join(root, 'project-a');
    for (const dir of [home, join(config, 'plugins'), project]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(config, 'plugins', 'plugin-directory-marketplace.json'), '{"enabled": false}\n');
    writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, projects: { [project]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } })}\n`);
    const market = join(root, 'maws-discover-test');
    cpSync(join(REPO, 'e2e/fixtures/catalog/marketplace'), market, { recursive: true });
    const pinned = join(root, 'maws-recorded-pins');
    mkdirSync(join(pinned, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pinned, '.claude-plugin', 'marketplace.json'), `${JSON.stringify(PINNED, null, 2)}\n`);
    const cli = (args, cwd = root) => execFileSync('/usr/bin/env', ['-i', `HOME=${home}`, `CLAUDE_CONFIG_DIR=${config}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', engine, 'plugin', ...args], { cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    cli(['marketplace', 'add', market, '--scope', 'user']);
    cli(['marketplace', 'add', pinned, '--scope', 'user']);
    cli(['install', 'skills-only@maws-discover-test', '--scope', 'user', '--json']);
    cli(['install', 'remote-server@maws-discover-test', '--scope', 'project', '--json'], project);
    const version = execFileSync(engine, ['--version'], { encoding: 'utf8' }).trim();
    const scrub = (text) => JSON.parse(text.replaceAll(root, '<scratch>'));
    mkdirSync(out, { recursive: true });
    const write = (file, args, cwd) => writeFileSync(join(out, file), `${JSON.stringify({ engine: version, argv: ['plugin', ...args], cwd: cwd.replaceAll(root, '<scratch>'), output: scrub(cli(args, cwd)) }, null, 2)}\n`);
    write('plugin-list-available.json', ['list', '--json', '--available'], project);
    write('plugin-list.json', ['list', '--json'], project);
    write('marketplace-list.json', ['marketplace', 'list', '--json'], project);
    console.log(`recorded the engine's listings (${version}) into ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- main ---------------------------------------------------------------------------------------------------------

const [mode, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
};
if (mode === 'network') await recordNetwork(resolve(REPO, option('out', 'e2e/fixtures/catalog')));
else if (mode === 'engine') recordEngine(resolve(REPO, option('out', 'test/fixtures/catalog')), option('engine', join(homedir(), '.local/share/claude/versions/2.1.309')));
else {
  console.error('usage: node scripts/catalog-fixtures.mjs network [--out <dir>] | engine [--engine <binary>] [--out <dir>]');
  process.exit(2);
}
