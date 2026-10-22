// P4-A2 (X35, M5 of docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md): the provisional layers' store over a
// fake handle: a streaming frame replaces its call's layer in place, a dropped one withdraws it, a committed one waits
// for the replica to integrate its row (rule 2), a lost connection ends the streams on it, and the stop clears all.
import type { ArtifactProvisional, ProvisionalOp } from '@shared/artifacts/provisional';
import { describe, expect, it } from 'vitest';
import type { DocumentState } from '../host';
import { openFile, ProvisionalLayers, type ProvisionalSource } from './layer';

function fakeHandle() {
  let state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 0, integrated: 4, readOnly: false };
  const frames = new Set<(frame: ArtifactProvisional) => void>();
  const states = new Set<(state: DocumentState) => void>();
  const source: ProvisionalSource = {
    onProvisional: (listener) => {
      frames.add(listener);
      return () => frames.delete(listener);
    },
    subscribe: (listener) => {
      states.add(listener);
      return () => states.delete(listener);
    },
    state: () => state,
  };
  return {
    source,
    send: (frame: ArtifactProvisional) => frames.forEach((listener) => listener(frame)),
    change: (next: Partial<DocumentState>) => {
      state = { ...state, ...next };
      states.forEach((listener) => listener(state));
    },
    listening: () => frames.size + states.size,
  };
}

const op = (text: string, block = 'p1'): ProvisionalOp => ({ op: 'replace_block', block, text });
const frame = (toolUseId: string, state: ArtifactProvisional['state'], ops: ProvisionalOp[] = [], commitSeq?: number): ArtifactProvisional => ({
  toolUseId: toolUseId as never,
  appSessionId: 's1' as never,
  artifactId: 'doc1',
  kind: 'document',
  state,
  ...(commitSeq !== undefined ? { commitSeq } : {}),
  at: 0,
  name: 'Fix the build',
  color: '--author-3',
  ops,
});

function attached() {
  const handle = fakeHandle();
  const layers = new ProvisionalLayers(handle.source);
  const stop = layers.attach();
  let told = 0;
  layers.subscribe(() => (told += 1));
  const texts = () => [...layers.get().values()].map((layer) => `${layer.toolUseId}:${layer.ops.map((o) => ('text' in o ? o.text : '')).join(',')}`);
  return { handle, layers, stop, told: () => told, texts };
}

describe('the provisional layers', () => {
  it('replace a call’s layer in its place with each streaming frame, telling once per change', () => {
    const { handle, layers, told, texts } = attached();
    handle.send(frame('a', 'streaming', [op('The')]));
    handle.send(frame('b', 'streaming', [op('Other', 'p2')]));
    handle.send(frame('a', 'streaming', [op('The new')]));
    expect(texts()).toEqual(['a:The new', 'b:Other']);
    expect(told()).toBe(3);
    const map = layers.get();
    expect(layers.get(), 'the same map until the next change').toBe(map);
  });

  it('withdraw a dropped call’s layer at once, and tell nothing for a call they do not hold', () => {
    const { handle, told, texts } = attached();
    handle.send(frame('a', 'streaming', [op('The')]));
    handle.send(frame('a', 'dropped'));
    expect(texts()).toEqual([]);
    handle.send(frame('z', 'dropped'));
    expect(told()).toBe(2);
  });

  it('keep a committed layer, with the committed ops, until the replica has integrated its row', () => {
    const { handle, told, texts } = attached();
    handle.send(frame('a', 'streaming', [op('The')]));
    handle.send(frame('a', 'committed', [op('The new text')], 6));
    expect(texts()).toEqual(['a:The new text']);
    handle.change({ integrated: 5, unsaved: 1 }); // an earlier row, and the person's own typing
    expect(texts()).toEqual(['a:The new text']);
    handle.send(frame('a', 'streaming', [op('The new')])); // a stale tick after the commit
    expect(texts()).toEqual(['a:The new text']);
    handle.change({ integrated: 6 });
    expect(texts()).toEqual([]);
    expect(told()).toBe(3);
  });

  it('withdraw a committed layer at the frame when its row is already integrated, or when it names none', () => {
    const { handle, texts } = attached();
    handle.send(frame('a', 'streaming', [op('The')]));
    handle.send(frame('a', 'committed', [op('The new')], 4));
    expect(texts()).toEqual([]);
    handle.send(frame('b', 'streaming', [op('The')]));
    handle.send(frame('b', 'committed', [op('The new')]));
    expect(texts()).toEqual([]);
    // a call this replica never drew (it attached after the last tick): nothing drawn for the one task before its row
    handle.send(frame('c', 'committed', [op('The whole batch')], 9));
    expect(texts()).toEqual([]);
  });

  it('end the streams of a lost connection and keep the committed layers for the reconnect’s step 2', () => {
    const { handle, texts } = attached();
    handle.send(frame('a', 'streaming', [op('Streaming')]));
    handle.send(frame('b', 'streaming', [op('Writ')]));
    handle.send(frame('b', 'committed', [op('Written')], 9));
    handle.change({ phase: 'off' });
    expect(texts()).toEqual(['b:Written']);
    handle.change({ phase: 'live', integrated: 9 });
    expect(texts()).toEqual([]);
  });

  // G2 (G-R1): a publish's streaming frame lists only the files that grew or appeared since the frame before
  it('merge a publish’s files by path: a later text replaces the earlier in its place, a new path is appended, an untouched op is kept as it was', () => {
    const { handle, layers } = attached();
    const file = (path: string, text: string): ProvisionalOp => ({ op: 'file', path, text });
    const files = () => [...layers.get().values()].map((layer) => layer.ops.map((o) => (o.op === 'file' ? `${o.path}=${o.text}` : o.op)));
    handle.send(frame('a', 'streaming', [file('project/deck.json', '{"order":["s1"'), file('project/slides/s1.html', '<section')]));
    const deck = layers.get().get('a')!.ops[0];
    handle.send(frame('a', 'streaming', [file('project/slides/s1.html', '<section id="s1"><p>'), file('project/slides/s2.html', '<sec')]));
    expect(files()).toEqual([['project/deck.json={"order":["s1"', 'project/slides/s1.html=<section id="s1"><p>', 'project/slides/s2.html=<sec']]);
    expect(layers.get().get('a')!.ops[0], 'a file no frame touched keeps its op, so a reader can tell it unchanged').toBe(deck);
    expect(openFile(layers.get().get('a')!), 'while it streams, the last file is the open one').toBe('project/slides/s2.html');
    // the committed frame names the seq and carries no new files: the files stand until the row is integrated
    handle.send(frame('a', 'committed', [], 7));
    expect(files()).toEqual([['project/deck.json={"order":["s1"', 'project/slides/s1.html=<section id="s1"><p>', 'project/slides/s2.html=<sec']]);
    expect(layers.get().get('a')!.state).toBe('committed');
    expect(openFile(layers.get().get('a')!), 'at the commit every file is whole').toBeNull();
    handle.change({ integrated: 7 });
    expect(files()).toEqual([]);
  });

  it('keep every other op list replacing the one before, and a call’s files apart from another call’s', () => {
    const { handle, layers } = attached();
    handle.send(frame('a', 'streaming', [{ op: 'dataset', dataset: 'sal', text: 'sal' }]));
    handle.send(frame('a', 'streaming', [{ op: 'dataset', dataset: 'sales', text: 'sales' }]));
    handle.send(frame('b', 'streaming', [{ op: 'file', path: 'project/slides/s1.html', text: '<section id="s1">' }]));
    handle.send(frame('c', 'streaming', [{ op: 'file', path: 'project/slides/s1.html', text: '<sect' }]));
    expect(openFile(layers.get().get('a')!), 'a layer with no files has none open').toBeNull();
    expect([...layers.get().values()].map((layer) => layer.ops)).toEqual([
      [{ op: 'dataset', dataset: 'sales', text: 'sales' }],
      [{ op: 'file', path: 'project/slides/s1.html', text: '<section id="s1">' }],
      [{ op: 'file', path: 'project/slides/s1.html', text: '<sect' }],
    ]);
  });

  it('stop listening and clear the layers when stopped', () => {
    const { handle, stop, texts } = attached();
    handle.send(frame('a', 'streaming', [op('The')]));
    stop();
    expect(texts()).toEqual([]);
    expect(handle.listening()).toBe(0);
    handle.send(frame('a', 'streaming', [op('The')]));
    expect(texts()).toEqual([]);
  });
});
