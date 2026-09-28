import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreFixture } from './store-fixture';

describe('StoreFixture builds a temporary config home', () => {
  let fixture: StoreFixture | null = null;
  afterEach(async () => {
    await fixture?.dispose();
    fixture = null;
  });

  it('lays out the four roots, writes transcripts under the slug, sidecars beside them, and rewrites with a new inode', async () => {
    fixture = await StoreFixture.create();
    expect(fixture.paths.configHome).toBe(fixture.configHome);
    for (const root of ['projects', 'sessions', 'jobs', 'tasks'] as const) expect(statSync(fixture.paths[root]).isDirectory()).toBe(true);

    const path = await fixture.addTranscript('/private/tmp/maws-fixture', 'S1', [{ type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'hi' } }]);
    expect(path).toBe(join(fixture.configHome, 'projects', '-private-tmp-maws-fixture', 'S1.jsonl'));
    expect(fixture.transcriptPath('S1')).toBe(path);
    expect(readFileSync(path, 'utf8')).toBe('{"type":"user","uuid":"u1","parentUuid":null,"message":{"role":"user","content":"hi"}}\n');

    await fixture.appendLines(path, ['{"type":"cost-state"}', '{"type":"ai-title","aiTitle":"T"}']);
    await fixture.appendBytes(path, Buffer.from('{"type":"user","uu'));
    expect(readFileSync(path, 'utf8').endsWith('{"type":"ai-title","aiTitle":"T"}\n{"type":"user","uu')).toBe(true);

    const before = statSync(path).ino;
    await fixture.rewriteFile(path, ['{"type":"user","uuid":"u1","parentUuid":null}']);
    expect(readFileSync(path, 'utf8')).toBe('{"type":"user","uuid":"u1","parentUuid":null}\n');
    expect(statSync(path).ino).not.toBe(before);

    const meta = await fixture.addSidecar('S1', 'subagents/agent-abc.meta.json', { agentType: 'general-purpose', description: 'd', toolUseId: 'toolu_1', spawnDepth: 1 });
    expect(meta).toBe(join(fixture.configHome, 'projects', '-private-tmp-maws-fixture', 'S1', 'subagents', 'agent-abc.meta.json'));
    expect(JSON.parse(readFileSync(meta, 'utf8')).toolUseId).toBe('toolu_1');
    const title = await fixture.addSidecar('S1', 'custom-title.json', '{"customTitle":"Named"}');
    expect(readFileSync(title, 'utf8')).toBe('{"customTitle":"Named"}');
    await expect(fixture.addSidecar('nope', 'custom-title.json', '{}')).rejects.toThrow(/no transcript/);

    const registry = await fixture.addRegistryRecord(4242, { sessionId: 'S1', kind: 'interactive' });
    expect(registry).toBe(join(fixture.configHome, 'sessions', '4242.json'));
    expect(JSON.parse(readFileSync(registry, 'utf8'))).toEqual({ sessionId: 'S1', kind: 'interactive' });
    await fixture.removeRegistryRecord(4242);
    expect(() => statSync(registry)).toThrow();
    const job = await fixture.addJob('abcd1234', { sessionId: 'S1', state: 'working' });
    expect(job).toBe(join(fixture.configHome, 'jobs', 'abcd1234', 'state.json'));
    const task = await fixture.addTask('S1', { id: '1', subject: 's', description: 'd', status: 'pending', blocks: [], blockedBy: [] });
    expect(task).toBe(join(fixture.configHome, 'tasks', 'S1', '1.json'));
    expect(JSON.parse(readFileSync(task, 'utf8')).subject).toBe('s');

    const home = fixture.configHome;
    await fixture.dispose();
    fixture = null;
    expect(() => statSync(home)).toThrow();
  });
});
