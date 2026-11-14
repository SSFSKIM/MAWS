import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { GlassGroup, GlassSurface, type BackdropHint } from '@vitreajs/vitrea-react';
import type { Level } from './env';

/** The id of the environment texture every group samples. */
export const ENV = { kind: 'texture', id: 'x-windows-env' } as const;

/** One thickness across every surface (DESIGN.md, family). */
export const THICKNESS = 8;

export type Sampler = (rect: { left: number; top: number; width: number; height: number }) => Level;

export interface ShellValue {
  dark: boolean;
  thickness: number;
  /** Reads the painted environment under a box; null until the first paint. */
  sampler: Sampler | null;
  /** Changes whenever a host may have moved: a window opened or closed, the scene changed. */
  layout: string;
  sidebar: boolean;
  side: boolean;
  setSidebar: (open: boolean) => void;
  setSide: (open: boolean) => void;
  /** Capture aids read from the address (`x=menu`, `x=tools`, …); never a design state. */
  flag: (name: string) => boolean;
}

const Ctx = createContext<ShellValue | null>(null);
export const ShellProvider = Ctx.Provider;
export function useShell(): ShellValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('windows: no shell');
  return v;
}

/**
 * What a group declares about its backdrop: the environment's level under the group's own box, not the whole
 * plane's average. A window covers a calm part of a scene and an ornament a bright part, and the runtime's own
 * reading of a texture is one average for the whole source. Re-read after every paint, resize and layout change,
 * and once more when a layout transition has landed.
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
      setHint((prev) =>
        prev && prev.luminance === luminance
          ? prev
          : { tone: luminance > 0.45 ? 'light' : luminance < 0.12 ? 'dark' : 'mixed', luminance },
      );
    };
    read();
    const landed = window.setTimeout(read, 620);
    window.addEventListener('resize', read);
    return () => {
      window.clearTimeout(landed);
      window.removeEventListener('resize', read);
    };
  }, [el, sampler, layout]);
  return hint;
}

export interface GlassProps {
  id: string;
  /** The record's role words: a window holds content, an ornament hangs at its edge, a control acts. */
  role: 'window' | 'ornament' | 'control';
  label: string;
  className: string;
  radius?: number;
  capsule?: boolean;
  plane?: 'base' | 'overlay';
  interactive?: boolean;
  /** False dematerialises the surface in place; the element stays. */
  present?: boolean;
  onPresentEnd?: (present: boolean) => void;
  children: ReactNode;
}

/** One glass host in a group of its own, sampling the environment, with its footprint declared. */
export function Glass({ id, role, label, className, radius, capsule, plane, interactive, present, onPresentEnd, children }: GlassProps) {
  const { thickness } = useShell();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const hint = useFootprintHint(el);
  return (
    <GlassGroup id={id} backdrop={ENV} hint={hint}>
      <GlassSurface
        asChild
        radius={radius}
        capsule={capsule}
        thickness={thickness}
        plane={plane}
        interactive={interactive}
        present={present}
        onPresentEnd={onPresentEnd}
        foreground="vibrant"
      >
        <section ref={setEl} aria-label={label} data-glass-role={role} data-away={present === false} className={`x-windows-host ${className}`}>
          {children}
        </section>
      </GlassSurface>
    </GlassGroup>
  );
}

/**
 * A control that exists only in one state of the layout. It is mounted absent and then materialises; leaving, it
 * dematerialises and is unmounted when the runtime says the exit has landed. Its opacity is never touched.
 */
export function TransientGlass({ show, ...rest }: GlassProps & { show: boolean }) {
  const [mounted, setMounted] = useState(show);
  const [present, setPresent] = useState(show);
  useEffect(() => {
    if (!show) {
      setPresent(false);
      return;
    }
    setMounted(true);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPresent(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [show]);
  if (!mounted) return null;
  return <Glass {...rest} present={present} onPresentEnd={(p) => !p && setMounted(false)} />;
}

/** Go to another scene of this experiment, keeping the scheme and the knobs. */
export function goScene(scene: 'session' | 'settings' | 'home') {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const [exp = 'windows'] = path.split('/');
  window.location.hash = `#/${exp}/${scene}${query ? `?${query}` : ''}`;
}

/** The state mark: shape and colour together, so a session's state needs no word. */
export function StateMark({ state }: { state: string }) {
  return <span className="x-windows-state" data-state={state} aria-hidden="true" />;
}

export const stateWord: Record<string, string> = {
  running: 'Running',
  approval: 'Waiting for your approval',
  question: 'Asked you a question',
  plan: 'Plan ready for review',
  unread: 'Finished, not read yet',
  idle: 'Finished',
};
