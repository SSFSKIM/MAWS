// The glass hosts of this synthesis. Every one stands on the field and samples it as a texture; the method (one
// group per host, the field's level declared under the host's own box, the root asked to re-measure while a host
// travels) is the Windows experiment's (`../windows/shell.tsx`), and the pane itself is the Field experiment's.
import { createContext, createElement, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { GlassGroup, GlassSurface, useGlassRoot, useGlassSamplingGap, type BackdropHint } from '@vitreajs/vitrea-react';
import type { Sampler } from './paint';

/** The texture every group samples: the painted field. */
export const FIELD = { kind: 'texture', id: 'xs-field' } as const;

/** One thickness across the family. */
export const THICKNESS = 8;

export interface ShellValue {
  /** Reads the painted field under a box; null until the first paint. */
  sampler: Sampler | null;
  /** Changes whenever a host may have moved: a pane opened or closed, the scene changed, the composer grew. */
  layout: string;
}
const Ctx = createContext<ShellValue>({ sampler: null, layout: '' });
export const ShellProvider = Ctx.Provider;
export const useShell = () => useContext(Ctx);

/**
 * What a group declares about its backdrop: the field's level under the group's own box. A texture group
 * otherwise takes one average for the whole painting, and the pane over the dusk, the capsule over the pale top
 * band and the composer over the gathered colour stand on three different levels. Re-read after a paint, a
 * resize and a layout change, and once more when the travel has landed.
 */
export function useFootprintHint(el: HTMLElement | null): BackdropHint | undefined {
  const { sampler, layout } = useShell();
  const [hint, setHint] = useState<BackdropHint | undefined>(undefined);
  useEffect(() => {
    if (!el || !sampler) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const luminance = Math.round(sampler(r).luminance * 100) / 100;
      setHint((prev) => (prev && prev.luminance === luminance ? prev : { tone: luminance > 0.45 ? 'light' : luminance < 0.12 ? 'dark' : 'mixed', luminance }));
    };
    read();
    const landed = window.setTimeout(read, 640);
    window.addEventListener('resize', read);
    return () => {
      window.clearTimeout(landed);
      window.removeEventListener('resize', read);
    };
  }, [el, sampler, layout]);
  return hint;
}

type Tag = 'nav' | 'aside' | 'form' | 'div' | 'button' | 'section';

export interface GlassProps extends Omit<HTMLAttributes<HTMLElement>, 'role' | 'children'> {
  id: string;
  tag?: Tag;
  /** The record's role words: a pane holds navigation or a session's tools; a control acts. */
  glassRole: 'window' | 'control';
  className: string;
  radius?: number;
  capsule?: boolean;
  plane?: 'base' | 'overlay';
  interactive?: boolean;
  /** False dematerialises the surface in place; the element and its content stay. */
  present?: boolean;
  tint?: string | null;
  hostRef?: Ref<HTMLElement>;
  children: ReactNode;
  type?: 'button' | 'submit';
  inert?: boolean;
}

/** One glass host in a group of its own, sampling the field, with its footprint declared. */
export function Glass({ id, tag = 'div', glassRole, className, radius, capsule, plane, interactive, present, tint, hostRef, children, ...rest }: GlassProps) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const hint = useFootprintHint(el);
  const ref = (node: HTMLElement | null) => {
    setEl(node);
    if (typeof hostRef === 'function') hostRef(node);
    else if (hostRef) (hostRef as { current: HTMLElement | null }).current = node;
  };
  return (
    <GlassGroup id={id} backdrop={FIELD} hint={hint} tint={tint}>
      <GlassSurface asChild radius={radius} capsule={capsule} thickness={THICKNESS} plane={plane} interactive={interactive} present={present} foreground="vibrant">
        {createElement(tag, { ref, 'data-glass-role': glassRole, className: `xs-host ${className}`, ...rest }, children)}
      </GlassSurface>
    </GlassGroup>
  );
}

/**
 * A host that slides keeps its size, which no observer reports, so while a layout change runs the root is asked
 * to re-measure on its own frames (never a second animation loop).
 */
export function LayoutPump() {
  const { layout } = useShell();
  const root = useGlassRoot();
  const first = useRef(true);
  useEffect(() => {
    if (!root) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const started = performance.now();
    let off: (() => void) | null = root.subscribe(() => {
      root.invalidateGeometry();
      if (performance.now() - started > 700 && off) {
        off();
        off = null;
      }
    });
    return () => off?.();
  }, [root, layout]);
  return null;
}

/**
 * The room two neighbouring capsules in the top band owe each other is the runtime's to derive; the layout reads
 * it as `--xs-og` and never types it. The largest value seen is kept, so a preference opens the row and never
 * closes it.
 */
export function Gaps() {
  const mark = useRef<HTMLSpanElement>(null);
  const og = useGlassSamplingGap([{ members: [[560, 36]] }, { members: [[88, 36]] }]);
  const widest = useRef(0);
  useEffect(() => {
    widest.current = Math.max(widest.current, og);
    mark.current?.closest<HTMLElement>('.x-sheet')?.style.setProperty('--xs-og', `${widest.current}px`);
  }, [og]);
  return <span ref={mark} hidden />;
}
