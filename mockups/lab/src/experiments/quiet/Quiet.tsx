import { useCallback, useState, type CSSProperties } from 'react';
import { PanelLeft, PanelRight, FileCode, Plus, X } from 'lucide-react';
import { approval, projects, tabs, type Session } from '../../content/fixtures';
import type { ExperimentProps, SceneId, Scheme } from '../../lab/types';
import { Lights, StateGlyph, isYours, stateWord } from './glyphs';
import { Pop, RootCtx } from './overlay';
import { Sidebar } from './Sidebar';
import { Aside, Ask, Home, SessionScene } from './Session';
import { Settings } from './Settings';
import t from './tokens.module.css';
import s from './quiet.module.css';

/** The owner's ground candidates. A chip names a light and a dark value; the scheme picks which one is painted. */
const grounds: Record<string, Record<Scheme, string>> = {
  warm: { light: '#faf9f5', dark: '#191919' },
  green: { light: '#faf9f5', dark: '#191c19' },
  lifted: { light: '#ffffff', dark: '#1f1f1f' },
  pure: { light: '#ffffff', dark: '#000000' },
};

export type Answer = null | 'approved' | 'denied';

/** Move between the lab's scenes from inside the window, keeping the scheme and the knobs. */
function go(scene: SceneId) {
  const h = window.location.hash;
  window.location.hash = /^#\/quiet\/[a-z]+/.test(h) ? h.replace(/^#\/quiet\/[a-z]+/, `#/quiet/${scene}`) : `#/quiet/${scene}`;
}

export default function Quiet({ scene, scheme, knobs }: ExperimentProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [asideOpen, setAsideOpen] = useState(true);
  const [answer, setAnswer] = useState<Answer>(null);
  const [section, setSection] = useState('Engine');

  // Answering the approval is real in the lab: the session goes back to work and its orange leaves the window.
  const live = useCallback(
    (x: Session): Session => {
      if (x.id !== 's2' || answer === null) return x;
      return answer === 'approved' ? { ...x, state: 'running', line: approval.command, age: 'now' } : { ...x, state: 'idle' };
    },
    [answer],
  );
  const sessions = projects.flatMap((p) => p.sessions).map(live);
  const waiting = sessions.filter((x) => isYours(x.state));

  const style = { '--q-ground': (grounds[knobs.ground ?? 'warm'] ?? grounds.warm!)[scheme] } as CSSProperties;

  return (
    <RootCtx.Provider value={root}>
      <div
        ref={setRoot}
        className={`${t.root} ${s.root}`}
        style={style}
        data-q-scheme={scheme}
        data-q-round={knobs.round ?? 'rounder'}
        data-q-prose={knobs.prose ?? 'serif'}
      >
        <Lights />
        <button
          className={`${s.icon} ${s.sideToggle}`}
          aria-label={sideOpen ? 'Hide the sidebar' : 'Show the sidebar'}
          aria-pressed={sideOpen}
          data-tip={sideOpen ? 'Hide sidebar' : 'Show sidebar'}
          data-tip-at="start"
          onClick={() => setSideOpen((v) => !v)}
          style={{ background: 'none' }}
        >
          <PanelLeft size={17} strokeWidth={1.75} />
        </button>

        <Sidebar scene={scene} open={sideOpen} live={live} answer={answer} onAnswer={setAnswer} section={section} go={go} />

        <main className={s.main}>
          <header className={s.bar} data-clear={!sideOpen}>
            {scene === 'session' ? <Tabs live={live} /> : <div className={s.tabs} />}
            <div className={s.barEnd}>
              {scene !== 'settings' && waiting.length > 0 && <Waiting waiting={waiting} onAnswer={setAnswer} />}
              {scene === 'session' && (
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
              )}
            </div>
          </header>
          {scene === 'session' && <SessionScene key="session" />}
          {scene === 'settings' && <Settings key="settings" help={knobs.help ?? 'hover'} onSection={setSection} />}
          {scene === 'home' && <Home key="home" />}
        </main>

        {scene === 'session' && <Aside open={asideOpen} />}
      </div>
    </RootCtx.Provider>
  );
}

function Tabs({ live }: { live: (x: Session) => Session }) {
  const all = projects.flatMap((p) => p.sessions);
  return (
    <div className={s.tabs} role="tablist">
      {tabs.map((tab) => {
        const session = all.find((x) => x.id === tab.id);
        const state = session ? live(session).state : undefined;
        return (
          <div key={tab.id} className={s.tab} role="tab" aria-selected={'active' in tab && tab.active === true} tabIndex={0}>
            <span className={s.slot}>
              <span className={s.slotState}>
                {tab.kind === 'file' ? <FileCode size={14} strokeWidth={1.75} /> : state ? <StateGlyph state={state} size={14} /> : null}
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

/** What waits for you, as the same glyphs the sidebar uses. It opens the list, with the approval answerable in place. */
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
        onClick={() => setOpen((v) => !v)}
      >
        {waiting.map((x) => (
          <StateGlyph key={x.id} state={x.state} size={14} />
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
