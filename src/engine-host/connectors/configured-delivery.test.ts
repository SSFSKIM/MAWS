import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V17 } from '@shared/settings/defaults';
import { ConfiguredDeliverySources } from './configured-delivery';
import type { SourceFiles } from './source-entry';

const URL = 'https://mcp.notion.com/mcp';
function scene() {
  const disk = new Map<string, string>();
  const files: SourceFiles = {
    read: async (path, max) => { const text = disk.get(path) ?? null; if (text && Buffer.byteLength(text) > max) throw new Error('large'); return text; },
    exists: async (path) => disk.has(path),
    executable: async () => { throw new Error('cold delivery must not resolve executables'); },
  };
  const app = (servers = [{ name: 'notion', type: 'http', url: URL }]) => disk.set('/app/settings.json', JSON.stringify({ ...SETTINGS_DEFAULTS_V17, engine: { ...SETTINGS_DEFAULTS_V17.engine, mcpServers: servers } }));
  const user = (mcpServers: Record<string, unknown>) => disk.set('/home/.claude.json', JSON.stringify({ mcpServers }));
  const sources = new ConfiguredDeliverySources({ userData: '/app', environment: { HOME: '/home' }, files });
  return { disk, app, user, sources };
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
    s.disk.set('/app/settings.json', '{"engine":{"mcpServers":[{"name":"notion","type":"http","url":"https://mcp.notion.com/mcp"}]}}');
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
});
