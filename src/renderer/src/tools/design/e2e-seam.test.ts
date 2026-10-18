// P3-E1 M6: the seam's within-a-frame probe on a receiving replica (src/renderer/src/tools/design/e2e-seam.ts). Only an
// inbound transaction (origin the replica's PortProvider) starts a measure; the edit's own transaction is told apart by
// the model value it turns true; the result reads the surface's DOM at the next animation frame after the frame arrived,
// so a surface that draws the edit synchronously is within the frame and one that draws it later is not. A local write
// never counts, and an open text box (a composition hold) or a value already there refuses to arm.
import { afterEach, describe, expect, it } from 'vitest';
import { PortProvider } from '@artifacts/provider/port';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '@artifacts/yjs';
import { boardFrame, writeBoardEntry, writeCanvasKeys } from '@artifacts/design/model';
import { setBoardFrame } from '@artifacts/design/writers';
import { importSlide } from '@artifacts/slides/model';
import { loadSlide } from '@artifacts/slides/parse';
import { frameProbe, lastDeclaration, type FrameProbeDom, type FrameProbeModel } from './e2e-seam';

function designDoc(): Doc {
  const doc = newDoc();
  transact(doc, () => {
    writeCanvasKeys(doc, { v: 1, title: 'Screens', boards: {}, order: [] });
    [
      { id: 'phone', frame: { x: 0, y: 0, w: 390, h: 844 } },
      { id: 'tablet', frame: { x: 500, y: 0, w: 834, h: 1194 } },
    ].forEach((b, i) => {
      const l = loadSlide(`<section id="${b.id}"><p id="p">Hi</p></section>`, { fileId: b.id });
      if (!l.ok) throw new Error('fixture');
      importSlide(doc, l.slide, `a${i}`);
      writeBoardEntry(doc, b.id, b.frame);
    });
  });
  return doc;
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

/** A receiving replica drawing the tablet's x into a node, now or `laterMs` after each update; its sender beside it. */
function scene(laterMs: number | null = null) {
  const local = designDoc();
  const remote = newDoc();
  applyV1(remote, diffV1(local));
  const provider = new PortProvider(local, { log: () => {} });
  const root = document.createElement('div');
  root.innerHTML = '<div data-board-id="tablet"></div>';
  document.body.appendChild(root);
  const node = root.querySelector<HTMLElement>('[data-board-id="tablet"]')!;
  const draw = () => (node.style.left = `${boardFrame(local, 'tablet')!.x}px`);
  draw();
  const off = onUpdate(local, () => (laterMs === null ? draw() : setTimeout(draw, laterMs)));
  cleanups.push(() => {
    off();
    provider.destroy();
    root.remove();
  });
  /** The sender's edit arriving through the replica's port (applied with the provider as its origin). */
  const inbound = (edit: (doc: Doc) => void) => {
    edit(remote);
    applyV1(local, diffV1(remote, stateVector(local)), provider);
  };
  return { local, remote, provider, root, inbound };
}

const MODEL: FrameProbeModel = { kind: 'frame', boardId: 'tablet', key: 'x', value: 600 };
const DOM: FrameProbeDom[] = [{ selector: '[data-board-id="tablet"]', style: 'left', equals: '600px' }];
const frames = (n = 3) => new Promise((resolve) => setTimeout(resolve, 20 * n));

describe('the within-a-frame probe', () => {
  it('measures the inbound transaction that brings the value, the DOM drawn before its sentinel frame', async () => {
    const s = scene();
    const probe = frameProbe(window, s.local, s.root, 'panel', MODEL, DOM);
    s.inbound((doc) => setBoardFrame(doc, 'phone', { y: 40 })); // another edit first: counted, not the one measured
    s.inbound((doc) => setBoardFrame(doc, 'tablet', { x: 600 }));
    expect(probe.result()).toBeNull(); // not before its frame
    await frames();
    const result = probe.result()!;
    expect(result).toMatchObject({ surface: 'panel', inbound: 2, withinFrame: true, atSentinel: [{ value: '600px', ok: true }] });
    expect(result.domObservedMs).not.toBeNull();
    expect(result.domObservedMs!).toBeLessThanOrEqual(result.sentinelMs);
  });

  it('says so when the surface draws the edit only after the next frame', async () => {
    const s = scene(200);
    const probe = frameProbe(window, s.local, s.root, 'panel', MODEL, DOM);
    s.inbound((doc) => setBoardFrame(doc, 'tablet', { x: 600 }));
    await frames();
    expect(probe.result()).toMatchObject({ withinFrame: false, domObservedMs: null, atSentinel: [{ value: '500px', ok: false }] });
  });

  it('never counts a local write, however it draws', async () => {
    const s = scene();
    const probe = frameProbe(window, s.local, s.root, 'panel', MODEL, DOM);
    setBoardFrame(s.local, 'tablet', { x: 600 });
    await frames();
    expect(probe.result()).toBeNull();
    probe.disarm();
  });

  it('refuses to arm under an open text box (its composition hold) or when the value is already there', () => {
    const s = scene();
    const box = document.createElement('div');
    box.className = 'deck-textbox';
    s.root.appendChild(box);
    expect(() => frameProbe(window, s.local, s.root, 'panel', MODEL, DOM)).toThrow(/text box is open/);
    box.remove();
    setBoardFrame(s.local, 'tablet', { x: 600 });
    expect(() => frameProbe(window, s.local, s.root, 'panel', MODEL, DOM)).toThrow(/already holds/);
  });
});

// DL39: the layout probe knows the requested override stands from the scope's stylesheet text alone (no style forced):
// the token's last declaration, the override block the system's tokens are followed by
describe('a scope stylesheet’s last declaration of a token', () => {
  const css = '[data-ds-scope="ds-1"] {\n  --ds-color-bg: ivory;\n  --ds-color-bg-subtle: gainsboro;\n  --ds-color-text: var(--ds-color-bg);\n}\n\n[data-ds-scope="ds-1"] {\n  --ds-color-bg: navy;\n}\n';
  it('reads the override that comes last, not a longer name or a var() use', () => {
    expect(lastDeclaration(css, '--ds-color-bg')).toBe('navy');
    expect(lastDeclaration(css, '--ds-color-bg-subtle')).toBe('gainsboro');
    expect(lastDeclaration(css.replace('  --ds-color-bg: navy;\n', ''), '--ds-color-bg')).toBe('ivory');
    expect(lastDeclaration(css, '--ds-color-accent')).toBeNull();
    expect(lastDeclaration('', '--ds-color-bg')).toBeNull();
  });
});
