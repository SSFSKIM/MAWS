// The window's zoom, the window's side (UX wave U6b-5b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, M2;
// decisions 25, 29 and 37; card K3). Main holds the factor (`window.zoom`, `src/main/zoom.ts`); the window reads it at
// start, follows `layout.zoomChanged`, and keeps it here for what sizes something in window points (the in-app browser's
// device box: `useZoom`) and on the root as `--app-zoom` (the traffic lights' clearance). Zoom In, Zoom Out and Actual
// Size are registered while each can change the factor, so the menu's items, the palette and the chords are disabled at
// the ends; each asks main. After every change an act made, one line says the size reached, as the app's own toast: the
// toast host draws it and says it to a screen reader, and a line still showing gives way to the next one.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import { ZOOM_MAX, ZOOM_MIN, type ZoomTo } from '@shared/ipc/schema/layout';
import type { ActionId } from '@shared/keymap/actions';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { toast, useNotices } from './notices';

export const ZOOM_LINE_MS = 1_500; // the line's time on screen (card K3)
export const zoomLine = (factor: number): string => `Zoom ${Math.round(factor * 100)} %`;

export const useZoom = create<{ factor: number }>()(() => ({ factor: 1 }));

const ACTS: readonly { id: ActionId; to: ZoomTo; can(factor: number): boolean }[] = [
  { id: 'zoom.in', to: 'in', can: (factor) => factor < ZOOM_MAX },
  { id: 'zoom.out', to: 'out', can: (factor) => factor > ZOOM_MIN },
  { id: 'zoom.reset', to: 'actual', can: (factor) => factor !== 1 },
];

// Mounted once from App.tsx. Subscribed first, then the factor read, so a change made meanwhile is not missed; once a
// change has been heard, the read's reply is older than it and is ignored.
export function connectZoom(client: MawsBridge = ipc): () => void {
  let live = true;
  let heard = false;
  let line: string | null = null;
  const handlers = new Map<ActionId, () => void>();
  const ask = (to: ZoomTo) => () =>
    void client.invoke('layout.zoom', { to }).then((result) => {
      if (!result.ok) console.warn(`[zoom] layout.zoom ${to} failed: ${result.error.message}`);
    });
  const apply = (factor: number) => {
    useZoom.setState({ factor });
    document.documentElement.style.setProperty('--app-zoom', String(factor));
    for (const { id, to, can } of ACTS) {
      const off = handlers.get(id);
      if (can(factor) && !off) handlers.set(id, registerAction(id, ask(to)));
      if (!can(factor) && off) {
        off();
        handlers.delete(id);
      }
    }
  };
  const say = (factor: number) => {
    if (line !== null) useNotices.getState().dismiss(line);
    line = toast({ level: 'info', text: zoomLine(factor), actions: [], dismissible: false, durationMs: ZOOM_LINE_MS });
  };
  const off = client.on('layout.zoomChanged', ({ factor }) => {
    heard = true;
    apply(factor);
    say(factor);
  });
  apply(useZoom.getState().factor);
  void client.invoke('layout.zoom', { to: 'current' }).then((result) => {
    if (!live || heard) return;
    if (result.ok) apply(result.value.factor);
    else console.warn(`[zoom] layout.zoom current failed: ${result.error.message}`);
  });
  return () => {
    live = false;
    off();
    for (const dispose of handlers.values()) dispose();
    handlers.clear();
  };
}
