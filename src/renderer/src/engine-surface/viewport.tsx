// A session's whole envelope in character cells, shared by its transcript, folded probes, composer and band.
// Individual pane sites supply their own measured envelope. Context reaches portaled native row bodies too.
import { createContext, useContext, type ReactNode, type RefObject } from 'react';
import { DEFAULT_SURFACE_VIEWPORT, type SurfaceViewport } from '@shared/engine/surface';
import { useCells } from './cells';

const Viewport = createContext<SurfaceViewport | undefined>(undefined);
export const useSurfaceViewport = () => useContext(Viewport);
export function SurfaceViewportProvider({ element, children }: { element: RefObject<HTMLElement | null>; children: ReactNode }) {
  const cells = useCells(element, DEFAULT_SURFACE_VIEWPORT);
  return <Viewport value={{ ...cells, isFullscreen: true }}>{children}</Viewport>;
}
