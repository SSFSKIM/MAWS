import { Suspense, useEffect, useState } from 'react';
import { experiments } from '../experiments/registry';
import { href, useRoute, type Route } from './route';
import type { Experiment, SceneId } from './types';
import './lab.css';

const sceneLabel: Record<SceneId, string> = { session: 'Session', settings: 'Settings', home: 'New chat', overview: 'Overview', file: 'File' };

function knobValues(exp: Experiment, route: Route): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of exp.knobs ?? []) {
    const v = route.knobs[k.id];
    out[k.id] = k.options.some((o) => o.value === v) ? (v as string) : k.default;
  }
  return out;
}

function Index() {
  return (
    <div className="lab-index">
      <div className="lab-index-inner">
        <h1>MAWS design lab</h1>
        <p className="lead">
          Each card is one experiment: the same invented sessions and settings, drawn under a different idea of what the
          redesign should treat as central. Open one, then use the LAB tab on the right edge (or the keys [ and ]) to move
          between experiments without losing the scene you are comparing.
        </p>
        <div className="lab-cards">
          {experiments.map((e) => (
            <div className="lab-card" key={e.id}>
              <div className="lab-id">{e.id}</div>
              <h3>{e.name}</h3>
              <p>{e.thesis}</p>
              <div className="lab-links">
                {e.scenes.map((s) => (
                  <span key={s} style={{ display: 'contents' }}>
                    <a href={href({ exp: e.id, scene: s, scheme: 'light' })}>{sceneLabel[s]}</a>
                    <a className="dark" href={href({ exp: e.id, scene: s, scheme: 'dark' })}>
                      {sceneLabel[s]} dark
                    </a>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Panel({ exp, route, onClose }: { exp: Experiment; route: Route; onClose: () => void }) {
  const knobs = knobValues(exp, route);
  return (
    <div className="lab-panel">
      <button className="lab-close" onClick={onClose} aria-label="Close the lab panel">
        ×
      </button>
      <h2>Experiment</h2>
      {experiments.map((e) => (
        <a
          key={e.id}
          className="lab-exp"
          aria-current={e.id === exp.id}
          href={href({ ...route, exp: e.id, scene: e.scenes.includes(route.scene) ? route.scene : e.scenes[0], knobs: {} })}
        >
          {e.name}
          {e.id === exp.id && <small>{e.thesis}</small>}
        </a>
      ))}
      <h2>Scene</h2>
      <div className="lab-row">
        {exp.scenes.map((s) => (
          <a key={s} className="lab-chip" aria-current={s === route.scene} href={href({ ...route, scene: s })}>
            {sceneLabel[s]}
          </a>
        ))}
      </div>
      <h2>Scheme</h2>
      <div className="lab-row">
        {(['light', 'dark'] as const).map((s) => (
          <a key={s} className="lab-chip" aria-current={s === route.scheme} href={href({ ...route, scheme: s })}>
            {s === 'light' ? 'Light' : 'Dark'}
          </a>
        ))}
      </div>
      {(exp.knobs ?? []).map((k) => (
        <div key={k.id}>
          <h2>{k.label}</h2>
          <div className="lab-row">
            {k.options.map((o) => (
              <a
                key={o.value}
                className="lab-chip"
                aria-current={knobs[k.id] === o.value}
                href={href({ ...route, knobs: { ...knobs, [k.id]: o.value } })}
              >
                {o.label}
              </a>
            ))}
          </div>
        </div>
      ))}
      <h2>What to look at</h2>
      <ul className="lab-notes">
        {exp.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <div className="lab-keys">
        [ ] experiment · {exp.scenes.map((_, i) => i + 1).join(' ')} scene · D scheme · L this panel · <a href="#/">all experiments</a>
      </div>
    </div>
  );
}

export function Lab() {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const exp = experiments.find((e) => e.id === route.exp) ?? null;

  useEffect(() => {
    if (!exp) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const i = experiments.indexOf(exp);
      const go = (r: Partial<Route> & { exp: string }) => {
        window.location.hash = href({ ...route, ...r });
      };
      const toExp = (e: Experiment) =>
        go({ exp: e.id, scene: e.scenes.includes(route.scene) ? route.scene : e.scenes[0], knobs: {} });
      if (ev.key === ']') toExp(experiments[(i + 1) % experiments.length]!);
      else if (ev.key === '[') toExp(experiments[(i - 1 + experiments.length) % experiments.length]!);
      else if (ev.key === 'd' || ev.key === 'D') go({ exp: exp.id, scheme: route.scheme === 'dark' ? 'light' : 'dark' });
      else if (ev.key === 'l' || ev.key === 'L') setOpen((v) => !v);
      else if (/^[1-9]$/.test(ev.key)) {
        const s = exp.scenes[Number(ev.key) - 1];
        if (s) go({ exp: exp.id, scene: s });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exp, route]);

  if (!exp) return <Index />;
  const scene = exp.scenes.includes(route.scene) ? route.scene : exp.scenes[0]!;
  const C = exp.Component;
  return (
    <>
      <div className="lab-stage">
        <Suspense fallback={<div className="lab-fallback">Loading…</div>}>
          {/* The key remounts an experiment when the scheme changes, so a glass root is rebuilt for the new material. */}
          <C key={`${exp.id}:${route.scheme}`} scene={scene} scheme={route.scheme} knobs={knobValues(exp, route)} />
        </Suspense>
      </div>
      {!route.bare &&
        (open ? (
          <Panel exp={exp} route={{ ...route, scene }} onClose={() => setOpen(false)} />
        ) : (
          <button className="lab-tab" onClick={() => setOpen(true)}>
            LAB
          </button>
        ))}
    </>
  );
}
