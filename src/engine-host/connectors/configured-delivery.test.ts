import { describe, expect, it, vi } from 'vitest';
import { clientSettingsDefaults, machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { ConfiguredDeliverySources } from './configured-delivery';
import type { SourceFiles } from './source-entry';
import { deferred } from './direct-pool.fixture';

const URL = 'https://mcp.notion.com/mcp';
function scene(captureEnv: () => Promise<Record<string, string>> = async () => ({ HOME: '/home' })) {
  const disk = new Map<string, string>();
  const files: SourceFiles = {
    read: async (path, max) => { const text = disk.get(path) ?? null; if (text && Buffer.byteLength(text) > max) throw new Error('large'); return text; },
    exists: async (path) => disk.has(path),
    executable: async () => { throw new Error('cold delivery must not resolve executables'); },
  };
  // P5 O3-A: MAWS's own servers in machine-settings.json; `unifiedApp`, a profile no split build has started
  const app = (servers = [{ name: 'notion', type: 'http', url: URL }]) => disk.set('/app/machine-settings.json', JSON.stringify({ ...machineSettingsDefaults(), engine: { ...machineSettingsDefaults().engine, mcpServers: servers } }));
  const unifiedApp = (servers = [{ name: 'notion', type: 'http', url: URL }]) => disk.set('/app/settings.json', JSON.stringify({ ...SETTINGS_DEFAULTS_V21, version: 20, engine: { ...SETTINGS_DEFAULTS_V21.engine, mcpServers: servers } }));
  const user = (mcpServers: Record<string, unknown>) => disk.set('/home/.claude.json', JSON.stringify({ mcpServers }));
  const sources = new ConfiguredDeliverySources({ userData: '/app', captureEnv, files });
  return { disk, files, app, unifiedApp, user, sources };
}

describe('cold owner delivery sources', () => {
  it('attests user HTTP and app settings without an engine report; returns no launch secrets', async () => {
    const s = scene();
    s.app();
    s.user({ personal: { type: 'http', url: URL, headers: { 'X-Private': 'secret' } } });
    const candidates = await s.sources.candidates();
    const verified = await Promise.all(candidates.map((c) => s.sources.resolveSource(c.cwd, c.server)));
    expect(verified.map((v) => v.ok && [v.source.server, v.source.scope, v.source.path, v.source.url])).toEqual([
      ['notion', 'app', '/app/settings.json', URL], ['personal', 'user', '/home/.claude.json', URL],
    ]);
    expect(JSON.stringify(verified)).not.toContain('secret');
    const personal = verified[1]!;
    if (!personal.ok) throw new Error('not verified');
    const read = await s.sources.readEntryForWrite(personal.source);
    expect(read.ok && read.entry).toEqual({ transport: 'http', url: URL, headers: { 'X-Private': 'secret' } });
  });

  it.each(['app', 'user'] as const)('keeps overlapping unchanged %s resolutions and write proofs valid', async (scope) => {
    const s = scene();
    if (scope === 'app') s.app([{ name: 'one', type: 'http', url: URL }, { name: 'two', type: 'http', url: URL }]);
    else s.user({ one: { type: 'http', url: URL }, two: { type: 'http', url: URL } });
    const [one, two] = await s.sources.candidates();
    const resolved = await Promise.all([one!, two!, one!].map((c) => s.sources.resolveSource(c.cwd, c.server)));
    expect(resolved.map((r) => r.ok && r.source.server)).toEqual(['one', 'two', 'one']);
    expect(resolved[2]).toEqual(resolved[0]);
    const proofs = await Promise.all(resolved.map((r) => {
      if (!r.ok) throw new Error('no source');
      return s.sources.readEntryForWrite(r.source);
    }));
    await Promise.all([s.sources.candidates(), s.sources.resolveSource(one!.cwd, one!.server)]);
    expect(proofs.map((p) => p.ok && p.stillValid())).toEqual([true, true, true]);
  });

  it.each(['app', 'user'] as const)('fences delayed and queued %s reads across clear without blocking the new attachment', async (scope) => {
    const s = scene();
    if (scope === 'app') s.app();
    else s.user({ notion: { type: 'http', url: URL } });
    const [candidate] = await s.sources.candidates();
    const first = await s.sources.resolveSource(candidate!.cwd, candidate!.server);
    if (!first.ok) throw new Error('no source');
    const earlier = await s.sources.readEntryForWrite(first.source);
    const reached = deferred();
    const release = deferred();
    const read = s.files.read;
    let delayed = true;
    s.files.read = async (...args) => {
      const text = await read(...args);
      if (delayed) { reached.resolve(); await release.promise; }
      return text;
    };
    const pending = s.sources.readEntryForWrite(first.source);
    await reached.promise;
    const queued = s.sources.readEntryForWrite(first.source);
    s.sources.clear();
    delayed = false;
    try {
      const fresh = await s.sources.resolveSource(candidate!.cwd, candidate!.server);
      if (!fresh.ok) throw new Error('no fresh source');
      expect(fresh.source.sourceId).not.toBe(first.source.sourceId);
      const proof = await s.sources.readEntryForWrite(fresh.source);
      expect(proof.ok && proof.stillValid()).toBe(true);
      expect(earlier.ok && earlier.stillValid()).toBe(false);
      release.resolve();
      expect(await pending).toEqual({ ok: false, why: 'changed' });
      expect(await queued).toEqual({ ok: false, why: 'changed' });
      expect(proof.ok && proof.stillValid()).toBe(true);
      expect(await s.sources.resolveSource(candidate!.cwd, candidate!.server)).toEqual(fresh);
    } finally { release.resolve(); }
  });

  it('lazily discovers the shell-captured config home instead of an obsolete launch-home entry', async () => {
    const captureEnv = vi.fn(async () => ({ HOME: '/home', CLAUDE_CONFIG_DIR: '/shell-config', PRIVATE_TOKEN: 'not-retained-in-sources' }));
    const s = scene(captureEnv);
    s.user({ obsolete: { type: 'http', url: 'https://obsolete.example/mcp' } });
    s.disk.set('/shell-config/.claude.json', JSON.stringify({ mcpServers: { personal: { type: 'http', url: URL } } }));
    expect(captureEnv).not.toHaveBeenCalled();
    const [candidate] = await s.sources.candidates();
    expect(candidate?.server).toBe('personal');
    const source = await s.sources.resolveSource(candidate!.cwd, candidate!.server);
    expect(source).toMatchObject({ ok: true, source: { path: '/shell-config/.claude.json', url: URL } });
    expect(JSON.stringify(source)).not.toContain('not-retained-in-sources');
    s.disk.set('/shell-config/.config.json', '{}');
    expect(await s.sources.candidates()).toEqual([]);
  });

  it.each(['CLAUDE_CONFIG_DIR', 'HOME'] as const)('changes the source path and revokes old proofs when captured %s refreshes, even at the same URL', async (key) => {
    let captured: Record<string, string> = { HOME: '/home', [key]: '/first-home' };
    const s = scene(async () => captured);
    const text = JSON.stringify({ mcpServers: { personal: { type: 'http', url: URL } } });
    // The inherited path also has the same entry: URL equality must not conceal a path change.
    s.disk.set('/home/.claude.json', text);
    s.disk.set('/first-home/.claude.json', text);
    s.disk.set('/second-home/.claude.json', text);
    const [candidate] = await s.sources.candidates();
    const first = await s.sources.resolveSource(candidate!.cwd, candidate!.server);
    if (!first.ok) throw new Error('no source');
    const proof = await s.sources.readEntryForWrite(first.source);
    expect(proof.ok && proof.stillValid()).toBe(true);
    captured = { HOME: '/home', [key]: '/second-home' };
    const refreshed = await s.sources.resolveSource(candidate!.cwd, candidate!.server);
    expect(first.source.path).toBe('/first-home/.claude.json');
    expect(refreshed).toMatchObject({ ok: true, source: { path: '/second-home/.claude.json', url: URL } });
    if (!refreshed.ok) throw new Error('no refreshed source');
    expect(refreshed.source.sourceId).not.toBe(first.source.sourceId);
    expect(refreshed.source.generation).toBeGreaterThan(first.source.generation);
    expect(proof.ok && proof.stillValid()).toBe(false);
    expect(await s.sources.readEntryForWrite(first.source)).toEqual({ ok: false, why: 'changed' });
    expect(await s.sources.resolveSource(candidate!.cwd, candidate!.server)).toEqual(refreshed);
  });

  it('never speculates on stdio, project/local entries, helpers, interpolation or unknown options', async () => {
    const s = scene();
    s.user({ stdio: { command: 'evil' }, helper: { type: 'http', url: URL, headersHelper: 'evil' }, template: { type: 'http', url: URL, headers: { Authorization: '${TOKEN}' } }, oauth: { type: 'http', url: URL, oauth: {} }, bad: { type: 'http', url: 'file:///tmp/private' } });
    expect(await s.sources.candidates()).toEqual([]);
    s.disk.set('/home/.claude.json', JSON.stringify({ projects: { '/repo': { mcpServers: { local: { type: 'http', url: URL } } } } }));
    expect(await s.sources.candidates()).toEqual([]);
  });

  it('refuses a legacy user file or invalid app settings without hiding the other valid scope', async () => {
    const s = scene(); s.app(); s.user({ personal: { type: 'http', url: URL } });
    s.disk.set('/home/.claude/.config.json', '{}');
    expect((await s.sources.candidates()).map((c) => c.server)).toEqual(['notion']);
    s.disk.delete('/home/.claude/.config.json');
    s.disk.set('/app/machine-settings.json', '{"engine":{"mcpServers":[{"name":"notion","type":"http","url":"https://mcp.notion.com/mcp"}]}}');
    expect((await s.sources.candidates()).map((c) => c.server)).toEqual(['personal']);
  });

  it('rereads changed and removed settings before use and invalidates earlier write proofs', async () => {
    const s = scene(); s.app();
    const [c] = await s.sources.candidates();
    const first = await s.sources.resolveSource(c!.cwd, c!.server);
    if (!first.ok) throw new Error('no source');
    const read = await s.sources.readEntryForWrite(first.source);
    expect(read.ok && read.stillValid()).toBe(true);
    s.app([{ name: 'notion', type: 'http', url: 'https://other.example/mcp' }]);
    expect(await s.sources.readEntryForWrite(first.source)).toEqual({ ok: false, why: 'changed' });
    expect(read.ok && read.stillValid()).toBe(false);
    s.app([]);
    expect(await s.sources.resolveSource(c!.cwd, c!.server)).toEqual({ ok: false, why: 'changed' });
  });

  it('keeps the app entry identity across unrelated changes and reordered settings; clear revokes it', async () => {
    const s = scene(); s.app();
    const [c] = await s.sources.candidates();
    const first = await s.sources.resolveSource(c!.cwd, c!.server);
    if (!first.ok) throw new Error('no source');
    s.app([{ name: 'other', type: 'http', url: 'https://other.example/mcp' }, { name: 'notion', type: 'http', url: URL }]);
    const again = await s.sources.resolveSource(c!.cwd, c!.server);
    expect(again).toEqual(first);
    const read = await s.sources.readEntryForWrite(first.source);
    s.sources.clear();
    expect(read.ok && read.stillValid()).toBe(false);
    expect(await s.sources.readEntryForWrite(first.source)).toEqual({ ok: false, why: 'changed' });
  });

  // P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §3; O3-A acceptance 4): the bytes move to
  // machine-settings.json, the identity keeps naming settings.json, so a grant saved before the split is adopted after it
  it('reads a unified settings.json while the machine file is absent, and names settings.json in the identity either way', async () => {
    const before = scene();
    before.unifiedApp();
    const [candidate] = await before.sources.candidates();
    const saved = await before.sources.resolveSource(candidate!.cwd, candidate!.server);
    if (!saved.ok) throw new Error('no source');
    // the split, and a fresh engine host after it (O2's update rule replaces an idle host)
    const after = scene();
    after.app();
    after.disk.set('/app/settings.json', JSON.stringify(clientSettingsDefaults()));
    const [split] = await after.sources.candidates();
    const adopted = await after.sources.resolveSource(split!.cwd, split!.server);
    if (!adopted.ok) throw new Error('no source');
    // what main's OAuth custody keys a grant on (oauthIdentityOf: url, server, scope, path, entryPath), as a sealed record
    // saved before the upgrade names it (src/services/connectors/oauth-store.test.ts builds one)
    const identity = ({ source }: { source: typeof saved.source }) => ({ requestUrl: source.url, server: source.server, scope: source.scope, configPath: source.path, entryPath: source.entryPath });
    expect(identity(saved)).toEqual({ requestUrl: URL, server: 'notion', scope: 'app', configPath: '/app/settings.json', entryPath: ['engine', 'mcpServers', 'name=notion'] });
    expect(identity(adopted)).toEqual(identity(saved));
  });

  it('lists no app server from a client settings.json with no machine file beside it, and keeps the user scope', async () => {
    const s = scene();
    s.disk.set('/app/settings.json', JSON.stringify(clientSettingsDefaults()));
    s.user({ personal: { type: 'http', url: URL } });
    expect((await s.sources.candidates()).map((c) => c.server)).toEqual(['personal']);
  });

  it('takes the machine file over a unified settings.json beside it (a split interrupted before the client file)', async () => {
    const s = scene();
    s.unifiedApp([{ name: 'stale', type: 'http', url: URL }]);
    s.app([{ name: 'notion', type: 'http', url: URL }]);
    expect((await s.sources.candidates()).map((c) => c.server)).toEqual(['notion']);
  });
});
