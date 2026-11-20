// Desktop: the native macOS reading. The window is opaque; one pane of it, the sidebar, is the Mac's own sidebar
// material and shows the desktop behind the window. DESIGN.md beside this file is the record.
import { PanelLeft } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { ExperimentProps, Scheme } from '../../lab/types';
import s from './desktop.module.css';
import { Pane } from './Pane';
import { HomeScene, SessionScene } from './Session';
import { SettingsScene } from './Settings';
import { MenuProvider } from './ui';
import { Wallpaper } from './Wallpaper';

/** The owner's ground candidates, as light · dark pairs so one knob covers both schemes. */
const grounds: Record<string, Record<Scheme, string>> = {
  a: { light: '#faf9f5', dark: '#191919' },
  b: { light: '#ffffff', dark: '#000000' },
  c: { light: '#faf9f5', dark: '#191c19' },
  d: { light: '#ffffff', dark: '#1f1f1f' },
};

export default function Desktop({ scene, scheme, knobs }: ExperimentProps) {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [outcome, setOutcome] = useState<'waiting' | 'approved' | 'denied'>('waiting');
  const [section, setSection] = useState('engine');
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null);
  // A native sidebar material is drawn only while its window is the active one.
  const [active, setActive] = useState(true);

  useEffect(() => {
    const on = () => setActive(true);
    const off = () => setActive(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);

  const pick = useCallback((id: string) => {
    setSection(id);
    setScrollTo((p) => ({ id, n: (p?.n ?? 0) + 1 }));
  }, []);

  const ground = (grounds[knobs.ground ?? 'a'] ?? grounds.a!)[scheme];

  return (
    <div
      className={s.root}
      data-scheme={scheme}
      data-material={knobs.material ?? 'system'}
      data-view={knobs.view ?? 'window'}
      data-active={active}
      data-collapsed={collapsed || undefined}
      style={{ '--ground': ground, colorScheme: scheme } as CSSProperties}
    >
      <Wallpaper name={knobs.wallpaper ?? 'dunes'} scheme={scheme} />
      <MenuProvider layer={layer}>
        <div className={s.window}>
          <div className={s.left}>
            <Pane scene={scene} resolved={outcome === 'approved'} section={section} onSection={pick} />
          </div>
          <main className={s.main}>
            {scene === 'settings' ? (
              <SettingsScene onSection={setSection} scrollTo={scrollTo} />
            ) : scene === 'home' ? (
              <HomeScene />
            ) : (
              <SessionScene outcome={outcome} onOutcome={setOutcome} />
            )}
          </main>
          <div className={s.lights} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <button type="button" className={s.paneToggle} aria-label={collapsed ? 'Show the sidebar' : 'Hide the sidebar'} aria-pressed={!collapsed} onClick={() => setCollapsed((v) => !v)}>
            <PanelLeft size={16} strokeWidth={1.7} />
          </button>
        </div>
      </MenuProvider>
      <div ref={setLayer} className={s.layer} />
    </div>
  );
}
