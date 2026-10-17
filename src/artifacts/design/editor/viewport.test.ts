// P3-E1 M3: the workbench's viewport math and the tab-owned view store (pan, zoom 2–400 %, fit all and fit selection,
// zoom about a point, the frame selection), pure.
import { describe, expect, it } from 'vitest';
import { clampZoom, DesignView, fitRect, panBy, stepZoom, toScreen, toWorld, unionRect, ZOOM_MAX, ZOOM_MIN, zoomAt } from './viewport';

describe('the viewport', () => {
  it('holds zoom to 2 %–400 %', () => {
    expect(ZOOM_MIN).toBe(0.02);
    expect(ZOOM_MAX).toBe(4);
    expect(clampZoom(0.001)).toBe(0.02);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it('maps world and screen points through one zoom and one pan', () => {
    const v = { zoom: 0.5, x: 100, y: 40 };
    expect(toScreen(v, { x: 200, y: 100 })).toEqual({ x: 200, y: 90 });
    expect(toWorld(v, { x: 200, y: 90 })).toEqual({ x: 200, y: 100 });
  });

  it('zooms about a screen point, which keeps the world point under it', () => {
    const v = { zoom: 1, x: 0, y: 0 };
    const at = { x: 300, y: 200 };
    const before = toWorld(v, at);
    const z = zoomAt(v, 2, at);
    expect(z.zoom).toBe(2);
    expect(toWorld(z, at)).toEqual(before);
    expect(zoomAt(v, 100, at).zoom).toBe(4); // clamped, the point still held
    expect(toWorld(zoomAt(v, 100, at), at)).toEqual(before);
  });

  it('pans by screen pixels', () => {
    expect(panBy({ zoom: 2, x: 10, y: 10 }, -30, 5)).toEqual({ zoom: 2, x: -20, y: 15 });
  });

  it('steps through the zoom steps from where it is', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.8, -1)).toBe(0.75);
    expect(stepZoom(0.8, 1)).toBe(1);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.02, -1)).toBe(0.02);
  });

  it('fits a rectangle centred in the room with an inset, never past 400 % (or the cap asked)', () => {
    const v = fitRect({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1096, h: 1096 }, 48);
    expect(v.zoom).toBe(1);
    expect(toScreen(v, { x: 500, y: 250 })).toEqual({ x: 548, y: 548 }); // the rectangle's centre at the room's
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 1000 }).zoom).toBe(4);
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, { w: 1000, h: 1000 }, 48, 1).zoom).toBe(1);
    // a 1080×8,192 poster beside a phone fits by its height
    const tall = fitRect({ x: 0, y: 0, w: 2000, h: 8192 }, { w: 1400, h: 900 }, 48);
    expect(tall.zoom).toBeCloseTo((900 - 96) / 8192, 6);
    // past what 2 % can show it holds 2 %, still centred
    const huge = fitRect({ x: 0, y: 0, w: 200_000, h: 1000 }, { w: 1000, h: 800 }, 48);
    expect(huge.zoom).toBe(0.02);
    expect(toScreen(huge, { x: 100_000, y: 500 })).toEqual({ x: 500, y: 400 });
  });

  it('unions rectangles, null for none', () => {
    expect(unionRect([])).toBeNull();
    expect(unionRect([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
  });
});

describe('the tab-owned view', () => {
  it('starts unplaced, takes its room, and a fit asked before the room lands once it is measured', () => {
    const view = new DesignView();
    expect(view.snapshot().viewport).toBeNull();
    view.fitTo({ x: 0, y: 0, w: 1000, h: 500 });
    expect(view.snapshot().viewport).toBeNull(); // no room yet: waits
    view.setRoom({ w: 1096, h: 1096 });
    expect(view.snapshot().viewport?.zoom).toBe(1);
  });

  it('keeps its place across a remount (the body asks to fit only when unplaced)', () => {
    const view = new DesignView();
    view.setRoom({ w: 800, h: 600 });
    view.setViewport({ zoom: 0.5, x: 12, y: 34 });
    expect(view.placed).toBe(true);
    view.setRoom({ w: 900, h: 600 }); // the body mounted again at another size: the place stays
    expect(view.snapshot().viewport).toEqual({ zoom: 0.5, x: 12, y: 34 });
  });

  it('zooms by steps about the room’s centre and clamps a set zoom', () => {
    const view = new DesignView();
    view.setRoom({ w: 1000, h: 800 });
    view.setViewport({ zoom: 1, x: 0, y: 0 });
    const centre = toWorld(view.snapshot().viewport!, { x: 500, y: 400 });
    view.step(1);
    expect(view.snapshot().viewport!.zoom).toBe(1.5);
    expect(toWorld(view.snapshot().viewport!, { x: 500, y: 400 })).toEqual(centre);
    view.setZoom(50);
    expect(view.snapshot().viewport!.zoom).toBe(4);
  });

  it('holds a board frame as the selection, and notifies its listeners only on change', () => {
    const view = new DesignView();
    let calls = 0;
    const off = view.subscribe(() => calls++);
    view.selectFrame('phone');
    view.selectFrame('phone');
    expect(view.snapshot().frame).toBe('phone');
    view.selectFrame(null);
    expect(calls).toBe(2);
    off();
    view.selectFrame('poster');
    expect(calls).toBe(2);
  });

  it('reads the mounted body’s room as it is at every fit, not the last one reported (a rail opened since)', () => {
    const view = new DesignView();
    view.setRoom({ w: 380, h: 730 }); // reported before the inspector opened under the world
    let live = { w: 380, h: 400 }; // the world's size now, its resize not yet reported
    const detach = view.measureRoomWith(() => live);
    view.fitTo({ x: 0, y: 0, w: 390, h: 844 }, 1);
    expect(view.snapshot().room).toEqual({ w: 380, h: 400 });
    expect(view.snapshot().viewport!.zoom).toBeCloseTo((400 - 96) / 844, 6);
    // a zoom step is about the room's centre now
    live = { w: 380, h: 300 };
    view.step(1);
    expect(view.snapshot().room).toEqual({ w: 380, h: 300 });
    // nothing measures, and the view keeps its place on a resize: no fit happens unasked
    view.setViewport({ zoom: 0.5, x: 10, y: 20 });
    live = { w: 380, h: 900 };
    view.setRoom(live);
    expect(view.snapshot().viewport).toEqual({ zoom: 0.5, x: 10, y: 20 });
    // the body gone: the last room stands; an unmeasurable body (hidden) is not read either
    detach();
    view.fitTo({ x: 0, y: 0, w: 390, h: 844 }, 1);
    expect(view.snapshot().room).toEqual({ w: 380, h: 900 });
    view.measureRoomWith(() => null);
    view.fitTo({ x: 0, y: 0, w: 390, h: 844 }, 1);
    expect(view.snapshot().room).toEqual({ w: 380, h: 900 });
  });
});
