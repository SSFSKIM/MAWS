import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FileCode, PanelLeft, PanelRight, Plus, SlidersHorizontal, X } from 'lucide-react';
import { approval, projects, tabs, type Session } from '../../content/fixtures';
import type { ExperimentProps, SceneId } from '../../lab/types';
import { Lights, StateGlyph, isYours, stateWord } from './glyphs';
import { Pop, RootCtx } from './overlay';
import { paintGround, type GroundSpec, type OrangeMode } from './paint';
import { Sidebar } from './Sidebar';
import { Aside, Ask, Home, SessionScene } from './Session';
import { Settings } from './Settings';
import { world, type Reading } from './world';
import t from './tokens.module.css';
import s from './orange.module.css';

export type Answer = null | 'approved' | 'denied';

const Probe = lazy(() => import('./Probe'));

/** Move between the lab's scenes from inside the window, keeping the scheme and the knobs. */
function go(scene: SceneId) {
  const h = window.location.hash;
  window.location.hash = /^#\/orange\/[a-z]+/.test(h) ? h.replace(/^#\/orange\/[a-z]+/, `#/orange/${scene}`) : `#/orange/${scene}`;
}

/** Capture aids read from the address (`x=tools,top,nosidebar,noside`); never a design state. */
function addressFlags(): string[] {
  return (new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('x') ?? '').split(',').filter(Boolean);
}

/** The ground: painted once per size and world, fixed to the window. */
function Ground({ spec }: { spec: GroundSpec }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => paintGround(c, spec);
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [spec]);
  return <canvas ref={ref} className={s.ground} aria-hidden="true" data-o-ground="" />;
}

export default function Orange({ scene, scheme, knobs }: ExperimentProps) {
  const flags = useMemo(addressFlags, [scene, scheme, knobs]);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [sideOpen, setSideOpen] = useState(() => !flags.includes('nosidebar'));
  const [asideOpen, setAsideOpen] = useState(() => !flags.includes('noside'));
  const [answer, setAnswer] = useState<Answer>(null);
  const [section, setSection] = useState('Engine');
  // The receded pose: a window that is not in front draws quieter glass.
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

  // Answering the approval is real in the lab: the session goes back to work and its solid mark leaves the window.
  const live = useCallback(
    (x: Session): Session => {
      if (x.id !== 's2' || answer === null) return x;
      return answer === 'approved' ? { ...x, state: 'running', line: approval.command, age: 'now' } : { ...x, state: 'idle' };
    },
    [answer],
  );
  const sessions = projects.flatMap((p) => p.sessions).map(live);
  const waiting = sessions.filter((x) => isYours(x.state));

  const orange = (['full', 'deep', 'light'].includes(knobs.orange ?? '') ? knobs.orange : 'full') as OrangeMode;
  const reading = (['glass', 'veil', 'opaque'].includes(knobs.reading ?? '') ? knobs.reading : 'glass') as Reading;
  const w = useMemo(() => world(scheme, orange, reading, knobs.ground ?? 'a'), [scheme, orange, reading, knobs.ground]);
  const asideShown = scene === 'session' && asideOpen;

  if (flags.includes('lib')) {
    return (
      <div className={`${t.root} ${s.root}`} style={{ ...(w.vars as CSSProperties), colorScheme: scheme }} data-x-orange="" data-o-scheme={scheme}>
        <Suspense fallback={null}>
          <Probe scheme={scheme} spec={w.spec} />
        </Suspense>
      </div>
    );
  }

  return (
    <RootCtx.Provider value={root}>
      <div
        ref={setRoot}
        className={`${t.root} ${s.root}`}
        style={{ ...(w.vars as CSSProperties), colorScheme: scheme }}
        data-x-orange=""
        data-o-scheme={scheme}
        data-o-orange={orange}
        data-o-reading={reading}
        data-o-type={knobs.type ?? 'figtree'}
        data-scene={scene}
        data-pose={active ? 'active' : 'inactive'}
        data-side={sideOpen ? 'open' : 'closed'}
        data-aside={asideShown ? 'open' : 'closed'}
      >
        <Ground spec={w.spec} />

        <Sidebar scene={scene} open={sideOpen} live={live} answer={answer} onAnswer={setAnswer} section={section} go={go} />
        {scene === 'session' && <Aside open={asideOpen} />}

        <main className={s.mid}>
          <header className={s.bar}>
            {scene === 'home' ? <span /> : <Tabs live={live} settings={scene === 'settings'} />}
            <div className={s.barEnd}>{waiting.length > 0 && <Waiting waiting={waiting} onAnswer={setAnswer} />}</div>
          </header>
          {scene === 'session' && <SessionScene key="session" flags={flags} />}
          {scene === 'settings' && <Settings key="settings" onSection={setSection} />}
          {scene === 'home' && <Home key="home" />}
        </main>

        <Lights />
        <div className={s.lead} data-away={!sideOpen}>
          <span className={`${s.puck} ${s.glass}`} />
          <button
            className={s.icon}
            aria-label={sideOpen ? 'Hide the sidebar' : 'Show the sidebar'}
            aria-pressed={sideOpen}
            data-tip={sideOpen ? 'Hide sidebar' : 'Show sidebar'}
            data-tip-at="start"
            onClick={() => setSideOpen((v) => !v)}
            style={{ background: 'none' }}
          >
            <PanelLeft size={17} strokeWidth={1.75} />
          </button>
        </div>
        {scene === 'session' && (
          <div className={s.trail} data-away={!asideOpen}>
            <span className={`${s.puck} ${s.glass}`} />
            <button
              className={s.icon}
              aria-label={asideOpen ? 'Hide the side column' : 'Show the side column'}
              aria-pressed={asideOpen}
              data-tip={asideOpen ? 'Hide details' : 'Show details'}
              data-tip-at="end"
              onClick={() => setAsideOpen((v) => !v)}
              style={{ background: 'none' }}
            >
              <PanelRight size={17} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </RootCtx.Provider>
  );
}

/** Instrument's tab capsule: one piece of glass on the ground, the tabs fills inside it. */
function Tabs({ live, settings }: { live: (x: Session) => Session; settings: boolean }) {
  const all = projects.flatMap((p) => p.sessions);
  const list = settings ? [...tabs, { id: 'settings', title: 'Settings', kind: 'settings' as const }] : tabs;
  return (
    <div className={`${s.tabs} ${s.glass}`} role="tablist" data-o-surface="Tabs">
      {list.map((tab) => {
        const session = all.find((x) => x.id === tab.id);
        const state = session ? live(session).state : undefined;
        const current = settings ? tab.kind === 'settings' : 'active' in tab && tab.active === true;
        return (
          <div key={tab.id} className={s.tab} role="tab" aria-selected={current} tabIndex={0}>
            <span className={s.slot}>
              <span className={s.slotState}>
                {tab.kind === 'file' ? (
                  <FileCode size={14} strokeWidth={1.75} />
                ) : tab.kind === 'settings' ? (
                  <SlidersHorizontal size={14} strokeWidth={1.75} />
                ) : state ? (
                  <StateGlyph state={state} size={11} />
                ) : null}
              </span>
              <button className={s.slotAct} aria-label={`Close ${tab.title}`} tabIndex={-1}>
                <X size={14} strokeWidth={2} />
              </button>
            </span>
            <span className={s.fade} title={state ? stateWord[state] : undefined}>
              {tab.title}
            </span>
          </div>
        );
      })}
      <button className={s.icon} aria-label="New tab" data-tip="New tab">
        <Plus size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** What waits for you, as the same marks the sidebar uses. It opens the list, with the approval answerable in place. */
function Waiting({ waiting, onAnswer }: { waiting: Session[]; onAnswer: (a: Answer) => void }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={setEl}
        className={s.waiting}
        aria-expanded={open}
        aria-label={`${waiting.length} sessions are waiting for you`}
        data-tip="Waiting for you"
        data-tip-at="end"
        data-o-surface="Waiting"
        onClick={() => setOpen((v) => !v)}
      >
        {waiting.map((x) => (
          <StateGlyph key={x.id} state={x.state} size={15} />
        ))}
      </button>
      <Pop open={open} anchor={el} place="below-end" onClose={close} className={s.waitList}>
        {waiting.map((x) => (
          <div key={x.id} className={s.waitItem} data-open={x.state === 'approval'}>
            <div className={s.waitHead}>
              <StateGlyph state={x.state} />
              <div className={s.waitText}>
                <div className={s.cardTitle}>{x.title}</div>
                <div className={s.cardLine}>{x.state === 'approval' ? approval.title : x.line}</div>
              </div>
              <span className={s.waitAge}>{x.age}</span>
            </div>
            {x.state === 'approval' && <Ask onAnswer={onAnswer} />}
          </div>
        ))}
      </Pop>
    </>
  );
}
