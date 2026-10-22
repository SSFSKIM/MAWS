// G2 memory investigation: real port -> replay -> store -> scratch -> stage/board and thumbnail canvases.
// Counts, not timing/working-set bounds. Removing any terminal cleanup leaves a payload, observer or DOM behind.
import { collectedHeapMiB } from '../../../../../test/support/optional-heap';
import { describe, expect, it } from 'vitest';

import type { ArtifactProvisional } from '@shared/artifacts/provisional';
import { encodeFrame, type Frame } from '../../../provider/frames';
import { PortProvider, type PortLike } from '../../../provider/port';
import { ProvisionalLayers } from '../../../provisional';
import { diffV1 } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import { DESIGN_FILES } from '../../../design/editor/provisional';
import { SlideCanvas, flushLayout } from '../../canvas';
import { slidePath } from '../../deck';
import { DeckProvisional } from './deck';
import { SlideProvisional, ThumbnailProvisional } from './slide';
import { deckWorld, publishFrame } from './testing';

/** The host end sends encoded frames, without a queue retaining test inputs. */
class InputPort implements PortLike {
  readonly listeners = { message: new Set<(event: { data?: unknown }) => void>(), close: new Set<(event: { data?: unknown }) => void>() };
  postMessage(): void {}
  close(): void {}
  addEventListener(type: 'message' | 'close', listener: (event: { data?: unknown }) => void): void { this.listeners[type].add(listener); }
  removeEventListener(type: 'message' | 'close', listener: (event: { data?: unknown }) => void): void { this.listeners[type].delete(listener); }
  send(frame: Frame): void { for (const listener of this.listeners.message) listener({ data: encodeFrame(frame) }); }
  announce(frame: ArtifactProvisional): void { this.send({ type: 'provisional', json: JSON.stringify(frame) }); }
}

// Test-only ownership inspection: no diagnostic API on product classes. Payload maps and subscribers are counted
// separately from the provider's connection-scoped stale-ID tombstones and Yjs's deleted structs.
function owned(value: object, key: string): { size: number } {
  return (value as Record<string, { size: number }>)[key]!;
}
function structs(doc: DeckProvisional['scratch']): number {
  return [...doc.store.clients.values()].reduce((n, client) => n + client.length, 0);
}

for (const kind of ['presentation', 'design'] as const) {
  describe(`${kind} provisional ownership`, () => {
    it.each(['committed', 'dropped'] as const)('releases payloads, scratch content and canvases after 100 %s calls', async (terminal) => {
      const w = deckWorld({ s1: '<section id="s1"><h1 id="title">Initial</h1></section>' });
      const provider = new PortProvider(w.doc);
      const port = new InputPort();
      provider.connect(port);
      port.send({ type: 'step2', update: diffV1(w.host), revision: 0 });
      const layers = new ProvisionalLayers({ onProvisional: (f) => provider.onProvisional(f), subscribe: (f) => provider.subscribe(f), state: () => ({ ...provider.state, readOnly: false }) });
      const stopLayers = layers.attach();
      const deck = new DeckProvisional(layers, w.doc, kind === 'design' ? DESIGN_FILES : undefined);
      const stopDeck = deck.attach();
      const root = document.body.appendChild(document.createElement('div'));
      const liveHost = root.appendChild(document.createElement('div'));
      const stageHost = root.appendChild(document.createElement('div'));
      const thumbHost = root.appendChild(document.createElement('div'));
      const live = new SlideCanvas(w.doc, 's1', liveHost);
      const stage = new SlideProvisional({ deck, slideId: 's1', live, host: stageHost, scaler: stageHost, assetUrl: () => null, label: (name) => name });
      const thumb = new ThumbnailProvisional({ deck, slideId: 's1', host: thumbHost, scaler: thumbHost, assetUrl: () => null });
      flushLayout();
      const baselineNodes = root.querySelectorAll('*').length;
      const residuals: { calls: number; nodes: number; scratchStructs: number; scratchBytes: number; endedIds: number; heapMiB?: number }[] = [];
      try {
        for (let i = 1; i <= 100; i++) {
          const call = `memory-${i}`;
          const file = `<section id="s1"><h1 id="title">Publish ${i}</h1></section>`;
          const path = kind === 'design' ? 'project/boards/s1.html' : slidePath('s1');
          port.announce({ ...publishFrame(call, 'streaming', { [path]: file }), kind });
          flushLayout();
          expect(layers.get().size).toBe(1);
          expect(deck.snapshot().slides.size).toBe(1);
          expect(root.querySelectorAll('section.maws-slide')).toHaveLength(3);
          expect(owned(provider, 'streaming').size).toBe(1);
          provider.holdRemote(true);
          port.announce({ ...publishFrame(call, terminal, {}, i), kind });
          if (terminal === 'committed') {
            port.send({ type: 'update', update: w.publish({ [slidePath('s1')]: file }), seq: i });
            expect(layers.get().size, 'the commit stays until its held row integrates').toBe(1);
          }
          provider.holdRemote(false);
          flushLayout();
          expect(layers.get().size).toBe(0);
          expect(deck.snapshot().slides.size).toBe(0);
          expect(Y.slideIds(deck.scratch)).toEqual([]);
          expect(structs(deck.scratch), 'idle scratch retains no publish history').toBe(0);
          for (const key of ['computed', 'written', 'observed', 'dirty']) expect(owned(deck, key).size, key).toBe(0);
          expect(owned(provider, 'streaming').size).toBe(0);
          let replayed = 0;
          provider.onProvisional(() => replayed++)();
          expect(replayed, 'late subscribers receive no ended call').toBe(0);
          expect(root.querySelectorAll('*')).toHaveLength(baselineNodes);
          expect(root.querySelectorAll('[data-provisional-writing], [data-provisional-veiled], [data-provisional-ghost]')).toHaveLength(0);
          if ([1, 10, 100].includes(i)) {
            // A diagnostic run may expose GC; not a heap bound (happy-dom has no Chromium compositor).
            await new Promise((resolve) => setTimeout(resolve, 0));
            const heapMiB = collectedHeapMiB?.();
            residuals.push({ calls: i, nodes: root.querySelectorAll('*').length, scratchStructs: structs(deck.scratch), scratchBytes: diffV1(deck.scratch).length, endedIds: owned(provider, 'ended').size, ...(heapMiB !== undefined && { heapMiB }) });
          }
        }
        stage.dispose();
        thumb.dispose();
        expect(owned(deck, 'listeners').size).toBe(0);
        expect(owned(live, 'layoutListeners').size).toBe(0);
        stopDeck();
        stopLayers();
        expect(owned(layers, 'listeners').size).toBe(0);
        expect(owned(provider, 'provisionalListeners').size).toBe(0);
        expect(owned(provider, 'listeners').size).toBe(0);
        provider.disconnect();
        expect(owned(provider, 'ended').size).toBe(0);
        expect(port.listeners.message.size + port.listeners.close.size).toBe(0);
        if (collectedHeapMiB) console.info('provisional lifecycle counts', kind, terminal, JSON.stringify(residuals));
      } finally {
        stage.dispose();
        thumb.dispose();
        stopDeck();
        stopLayers();
        live.dispose();
        provider.destroy();
        deck.scratch.destroy();
        w.doc.destroy();
        w.host.destroy();
        root.remove();
      }
    });
  });
}
