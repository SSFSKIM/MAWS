// How content stands on glass here. A block stays an ordinary element in its own flow (a transcript card in the
// scrolling column, a module in the side column), and a layer draws one decorative glass surface beneath each,
// placed from the block's measured box. The block's text is therefore real, selectable, in reading order, and the
// same markup serves the Veil and Opaque materials, which draw a CSS fill and register nothing.
//
// The glass library portals every host into its root's plane, where it cannot follow a flow, so the layer re-reads
// each block's box and writes it to the host: on a resize, and on every frame for a short while after anything
// that moves blocks without resizing them (a fold opening above, a pane sliding).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { GlassGroup, GlassSurface, useGlassRoot } from '@vitreajs/vitrea-react';

export const PLANE = { kind: 'texture', id: 'xl-plane' } as const;
/** One thickness across every surface. */
export const THICKNESS = 8;

interface Entry {
  el: HTMLElement;
  radius: number;
  capsule: boolean;
  /** An ancestor that clips the block while it opens; the glass is cut to what shows. */
  clip: HTMLElement | null;
  /** False asks the glass to dematerialise in place (a module being put away). */
  want: boolean;
  shown: boolean;
}

interface Registry {
  add: (id: string, entry: Omit<Entry, 'shown'>) => void;
  remove: (id: string) => void;
  /** Re-read every block on each frame for this long. */
  kick: (ms?: number) => void;
}

const LayerCtx = createContext<Registry | null>(null);

/** Ask the nearest layer to follow moving blocks for a while. A no-op where no layer draws glass. */
export function useKick() {
  const layer = useContext(LayerCtx);
  return useCallback((ms?: number) => layer?.kick(ms), [layer]);
}

interface LayerProps {
  /** The sampling group every surface of this layer joins. */
  group: string;
  /** `viewport`: hosts are fixed. `container`: hosts sit in the coordinates of the attached root's container. */
  space: 'viewport' | 'container';
  /** The container, for `space="container"`. */
  origin?: HTMLElement | null;
  /** Changes when blocks may have moved for a reason no observer reports. */
  layout?: string;
  children: ReactNode;
}

export function GlassLayer({ group, space, origin, layout, children }: LayerProps) {
  const root = useGlassRoot();
  const entries = useRef(new Map<string, Entry>());
  const hosts = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, string>());
  const [version, setVersion] = useState(0);
  const until = useRef(0);
  const frame = useRef(0);
  const rootRef = useRef(root);
  rootRef.current = root;
  const originRef = useRef(origin);
  originRef.current = origin;

  const sync = useCallback(() => {
    const base = space === 'container' ? originRef.current?.getBoundingClientRect() : { left: 0, top: 0 };
    if (!base) return;
    let moved = false;
    let flipped = false;
    for (const [id, e] of entries.current) {
      const r = e.el.getBoundingClientRect();
      let top = r.top;
      let bottom = r.bottom;
      if (e.clip) {
        const c = e.clip.getBoundingClientRect();
        top = Math.max(top, c.top);
        bottom = Math.min(bottom, c.bottom);
      }
      const height = Math.max(0, bottom - top);
      // Under a few pixels there is no surface to draw; the glass waits absent and materialises as the block grows.
      const shown = e.want && height >= 10 && r.width >= 10;
      if (shown !== e.shown) {
        e.shown = shown;
        flipped = true;
      }
      const host = hosts.current.get(id);
      if (!host) continue;
      const box = `${(r.left - base.left).toFixed(2)},${(top - base.top).toFixed(2)},${r.width.toFixed(2)},${Math.max(10, height).toFixed(2)}`;
      if (last.current.get(id) === box) continue;
      last.current.set(id, box);
      const [x, y, w, h] = box.split(',');
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.width = `${w}px`;
      host.style.height = `${h}px`;
      moved = true;
    }
    if (moved) rootRef.current?.invalidateGeometry();
    if (flipped) setVersion((v) => v + 1);
  }, [space]);

  const kick = useCallback(
    (ms = 700) => {
      until.current = Math.max(until.current, performance.now() + ms);
      if (frame.current) return;
      const tick = () => {
        sync();
        // A block that moved with its container kept its box in that container's coordinates, so nothing was
        // written; the runtime still has to be told that the host is somewhere else in the window.
        rootRef.current?.invalidateGeometry();
        frame.current = performance.now() < until.current ? requestAnimationFrame(tick) : 0;
      };
      frame.current = requestAnimationFrame(tick);
    },
    [sync],
  );

  const sizes = useRef<ResizeObserver | null>(null);
  if (!sizes.current && typeof ResizeObserver !== 'undefined') sizes.current = new ResizeObserver(() => kick(120));

  const registry = useMemo<Registry>(
    () => ({
      add: (id, entry) => {
        const had = entries.current.get(id);
        if (had && had.el !== entry.el) sizes.current?.unobserve(had.el);
        entries.current.set(id, { ...entry, shown: had?.shown ?? false });
        sizes.current?.observe(entry.el);
        setVersion((v) => v + 1);
        kick(400);
      },
      remove: (id) => {
        const had = entries.current.get(id);
        if (had) sizes.current?.unobserve(had.el);
        entries.current.delete(id);
        hosts.current.delete(id);
        last.current.delete(id);
        setVersion((v) => v + 1);
      },
      kick,
    }),
    [kick],
  );

  useEffect(() => {
    if (origin) sizes.current?.observe(origin);
    const onResize = () => kick(200);
    window.addEventListener('resize', onResize);
    void document.fonts?.ready.then(() => kick(300));
    return () => {
      window.removeEventListener('resize', onResize);
      if (origin) sizes.current?.unobserve(origin);
    };
  }, [origin, kick]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // A pane sliding, a scene arriving: follow for the length of the longest layout transition.
  useEffect(() => kick(900), [layout, kick]);
  // A host that has just mounted has no box yet.
  useLayoutEffect(() => {
    last.current.clear();
    sync();
  }, [version, sync]);

  return (
    <GlassGroup id={group} backdrop={PLANE}>
      {/* Children stand inside the group, so a real control among them (the waiting capsule) joins it. */}
      <LayerCtx.Provider value={registry}>{children}</LayerCtx.Provider>
      {/* A circular corner, so the block's own CSS corner (its clip and its shadow) is the same curve exactly. */}
      {[...entries.current].map(([id, e]) => (
        <GlassSurface key={id} asChild decorative profile="circular" radius={e.radius} capsule={e.capsule} thickness={THICKNESS} present={e.shown}>
          <div
            className="xl-under"
            data-space={space}
            ref={(el) => {
              if (el) hosts.current.set(id, el);
            }}
          />
        </GlassSurface>
      ))}
    </GlassGroup>
  );
}

let serial = 0;

/**
 * Stand this element on glass, where a layer is drawing it. Returns whether glass is drawn, so a caller can skip
 * work that only glass needs.
 */
export function useGlassUnder(
  ref: RefObject<HTMLElement | null>,
  opts: { radius?: number; capsule?: boolean; clip?: HTMLElement | null; on?: boolean; want?: boolean } = {},
): boolean {
  const layer = useContext(LayerCtx);
  const id = useRef('');
  if (!id.current) id.current = `xl-b${++serial}`;
  const { radius = 18, capsule = false, clip = null, on = true, want = true } = opts;
  // Upsert on every change of an option; leave the layer only when the block does.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!layer || !el || !on) return;
    layer.add(id.current, { el, radius, capsule, clip, want });
  }, [layer, ref, radius, capsule, clip, on, want]);
  useLayoutEffect(() => {
    if (!layer || !on) return;
    const key = id.current;
    return () => layer.remove(key);
  }, [layer, on]);
  return layer !== null;
}
