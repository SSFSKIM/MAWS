import { describe, expect, it, vi } from 'vitest';
import { createChunkGate } from './chunk-gate';

const BASE = 'http://sheet.localhost:47000/assets/index-a.js';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig(proven = false) {
  const state = { proven };
  const asked: string[] = [];
  const answers: Array<{ resolve: (module: unknown) => void; reject: (error: unknown) => void }> = [];
  const gate = createChunkGate({
    proven: () => state.proven,
    importer: (url) => {
      asked.push(url);
      return new Promise((resolve, reject) => answers.push({ resolve, reject }));
    },
  });
  return { gate, state, asked, answers };
}

describe('the chunk gate (T28)', () => {
  it('asks for a chunk at once while the connection is proven, resolved against the chunk that asked', async () => {
    const { gate, asked, answers } = rig(true);
    const loaded = gate.load(BASE, './lang-ts-b.js');
    await settle();
    expect(asked).toEqual(['http://sheet.localhost:47000/assets/lang-ts-b.js']);
    answers[0]!.resolve({ default: 'ts' });
    await expect(loaded).resolves.toEqual({ default: 'ts' });
  });

  it('asks for nothing while unproven, and asks once a proven connection opens', async () => {
    const { gate, state, asked, answers } = rig(false);
    const loaded = gate.load(BASE, './mermaid-c.js');
    await settle();
    gate.opened(); // a connection opened, but the proof is not the page's now (proven() is null)
    await settle();
    expect(asked).toEqual([]);
    state.proven = true;
    gate.opened();
    await settle();
    expect(asked).toEqual(['http://sheet.localhost:47000/assets/mermaid-c.js']);
    answers[0]!.resolve('mermaid');
    await expect(loaded).resolves.toBe('mermaid');
  });

  it('a load that failed is asked again only on the next proven connection, under a fresh specifier', async () => {
    const { gate, asked, answers } = rig(true);
    const loaded = gate.load(BASE, './lang-go-d.js');
    await settle();
    answers[0]!.reject(new TypeError('Failed to fetch dynamically imported module'));
    await settle();
    await settle();
    expect(asked).toHaveLength(1); // still the same connection: no second try on it
    gate.opened();
    await settle();
    expect(asked).toEqual(['http://sheet.localhost:47000/assets/lang-go-d.js', 'http://sheet.localhost:47000/assets/lang-go-d.js?again=1']);
    answers[1]!.resolve('go');
    await expect(loaded).resolves.toBe('go');
  });

  it('each chunk waits on its own: one proven connection lets all the waiting through', async () => {
    const { gate, state, asked } = rig(false);
    void gate.load(BASE, './a.js');
    void gate.load(BASE, './b.js');
    await settle();
    state.proven = true;
    gate.opened();
    await settle();
    expect(asked.sort()).toEqual(['http://sheet.localhost:47000/assets/a.js', 'http://sheet.localhost:47000/assets/b.js']);
  });
});

describe('installChunkGate', () => {
  it('is what the build rewrites every dynamic import to call', async () => {
    const { installChunkGate, CHUNK_GATE_GLOBAL } = await import('./chunk-gate');
    const load = vi.fn(() => Promise.resolve('x'));
    installChunkGate({ load, opened: () => {} });
    await (globalThis as unknown as Record<string, (base: string, specifier: string) => Promise<unknown>>)[CHUNK_GATE_GLOBAL]!(BASE, './x.js');
    expect(load).toHaveBeenCalledWith(BASE, './x.js');
  });
});
