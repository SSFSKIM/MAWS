// @vitest-environment happy-dom
// The page's canvases for the bundled defaults as the app seeds them (UX wave U10b-4's branch review; §J). A DOM
// environment because the frames' sources rewrite each component's asset references with DOMParser; the `artifacts`
// project still reads the defaults' `document.css` as text, so the font faces compared are the real ones.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEMS } from '../../types/design_system/defaults';
import { applyV1, diffV1, newDoc } from '../../yjs';
import { fontFaceCss } from '../assets';
import { readSystem, writeSystem } from '../model';
import { canonFrames } from './Canon';
import { componentCanvas } from './component-canvas';

// The branch review of U10b-4: the table's canvases hold only while a component is drawn as it was measured, which the
// page tells by comparing the frame's generated token and font-face CSS with the bundle's. A default seeded as the app
// seeds it (seed.ts: `writeSystem` of the bundled files under its key, read back through a replica) and never edited
// must pass that comparison byte for byte, or every bundled component would fall to the largest canvas. This project
// reads the defaults' `document.css` as text, so the faces compared are the real ones (Official declares two).
describe('a bundled default as seeded, nothing edited', () => {
  const toUrl = (ref: string) => `maws-artifact://ds/live/${ref}`;
  it.each(DEFAULT_SYSTEMS.map((source) => [source.key, source] as const))('%s: every component takes the table’s canvas', (key, source) => {
    const seeded = newDoc();
    writeSystem(seeded, source.files, { route: 'default', key, at: 1 }, { name: source.name });
    const replica = newDoc();
    applyV1(replica, diffV1(seeded));
    const system = readSystem(replica);
    const frames = canonFrames(system.tokens, system.files, toUrl, key);
    expect(frames.components.length).toBeGreaterThan(0);
    for (const frame of frames.components) expect(frame.canvas, frame.path).toEqual(componentCanvas(key, frame.path));
  });

  it('compares real faces: the bundled stylesheets are read here, and one of them declares faces', () => {
    for (const source of DEFAULT_SYSTEMS) expect(source.files['components/document.css']?.length ?? 0, source.key).toBeGreaterThan(0);
    const official = DEFAULT_SYSTEMS.find((source) => source.key === 'official')!;
    const system = readSystem((() => {
      const doc = newDoc();
      writeSystem(doc, official.files, { route: 'default', key: 'official', at: 1 }, { name: official.name });
      return doc;
    })());
    expect(fontFaceCss(system.files['components/document.css'], system.tokens, toUrl)).toContain('@font-face');
  });
});
