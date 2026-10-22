// G2 memory investigation: idle layers on the scale gate's actual 24-board fixture, with no stream ever sent.
// This proves DOM/subscription costs only. Optional NODE_OPTIONS=--expose-gc reports Node/happy-dom heap, not an
// Electron working set or compositor allocation, and does not turn this into a measured acceptance bound.
import { collectedHeapMiB } from '../../../../test/support/optional-heap';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { newDoc } from '../../yjs';
import { flushLayout } from '../../slides/canvas';
import { DeckProvisional } from '../../slides/editor/provisional/deck';
import { replica } from '../../slides/editor/provisional/testing';
import { DeckSession } from '../../slides/editor/session';
import { benchBoards, benchDesignFiles } from '../fixtures/bench';
import { publishCanvas } from '../publish';
import { DesignWorkbench } from './DesignWorkbench';
import { DesignView } from './viewport';

const size = (object: object, key: string) => (object as Record<string, Set<unknown>>)[key]!.size;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('mounts no idle ghost DOM and releases the model subscriptions when disabled on the 24-board bench', async () => {
  const doc = newDoc();
  const seeded = publishCanvas(doc, {}, benchDesignFiles('Memory bench'), false);
  expect(seeded.conflicts).toEqual([]);
  const source = replica(doc);
  const stopLayers = source.layers.attach();
  const session = new DeckSession(doc, 0);
  const view = new DesignView();
  view.setRoom({ w: 1000, h: 800 });
  view.setViewport({ zoom: 0.25, x: 0, y: 0 });
  const captured: { model: DeckProvisional | null } = { model: null };
  const attach = DeckProvisional.prototype.attach;
  vi.spyOn(DeckProvisional.prototype, 'attach').mockImplementation(function (this: DeckProvisional) {
    captured.model = this;
    const stop = attach.call(this);
    return () => { stop(); captured.model = null; };
  });
  const assetUrl = () => null;
  const element = (enabled: boolean) => <DesignWorkbench session={session} view={view} assetUrl={assetUrl} system={null} readOnly={false} provisional={enabled ? source.layers : null} />;
  const mounted = render(element(false));
  const samples: { enabled: boolean; nodes: number; sessionListeners: number; viewListeners: number; layerListeners: number; deckListeners: number; heapMiB?: number }[] = [];
  try {
    // Warm both paths before comparing the same retained tree; alternate order to expose a first-mount artifact.
    for (const enabled of [true, false, false, true, false, true, false, true, false]) {
      mounted.rerender(element(enabled));
      act(() => flushLayout());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(mounted.container.querySelectorAll('[data-board-id] section.maws-slide')).toHaveLength(benchBoards().length);
      expect(mounted.container.querySelectorAll('[data-provisional-layer], [data-provisional-new-board], [data-provisional-ghost]')).toHaveLength(0);
      expect(size(source.layers, 'listeners')).toBe(enabled ? 1 : 0);
      const { model } = captured;
      if (model) {
        expect(model.snapshot().slides.size).toBe(0);
        expect(model.scratch.store.clients.size).toBe(0);
        expect(size(model, 'listeners')).toBe(25); // 24 board-written selectors and the new-board collection
      }
      const heapMiB = collectedHeapMiB?.();
      samples.push({ enabled, nodes: mounted.container.querySelectorAll('*').length, sessionListeners: size(session, 'listeners'), viewListeners: size(view, 'listeners'), layerListeners: size(source.layers, 'listeners'), deckListeners: model ? size(model, 'listeners') : 0, ...(heapMiB !== undefined && { heapMiB }) });
    }
    expect(new Set(samples.map((sample) => sample.nodes)).size, 'idle enablement adds no DOM nodes').toBe(1);
    expect(new Set(samples.map((sample) => sample.sessionListeners)).size).toBe(1);
    expect(new Set(samples.map((sample) => sample.viewListeners)).size).toBe(1);
    if (collectedHeapMiB) console.info('idle provisional bench counts', JSON.stringify(samples));
  } finally {
    mounted.unmount();
    stopLayers();
    session.dispose();
    doc.destroy();
  }
}, 30_000);
