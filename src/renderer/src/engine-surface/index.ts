// The engine's remote surface in the renderer (R2; charter D-9 as amended 2026-10-01, the waves plan's R2 rulings): the
// element renderer, the render sites' instance registry, and the connection that keeps them current. The sites (the
// band, the mode chip, the hint, the working label, panes) place these; the composer answers the engine's prompt
// requests.
export { SurfaceTree, SURFACE_COPY } from './SurfaceTree';
export { SurfaceSite, drawnTree, type SurfaceSiteProps } from './SurfaceSite';
export { connectEngineSurface, useSurfaceAttached, useSurfaceSite, type SiteOptions } from './site';
export { invalidateSession, resetSurfaceRegistry, type SiteAnswer } from './registry';
export { drawsEngine, parseTree, textOf, type SurfaceNode } from './tree';
export type { Site } from './actions';
export { connectSurfaceAsks, ASK_COPY } from './asks';
export { useSpinnerText } from './spinner';
