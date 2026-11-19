// The sidebar: the one translucent surface in the window. What it lists is the app's; its colour is the desktop's.
import { ChevronLeft, ChevronRight, LayoutGrid, Settings, Shapes, SlidersHorizontal, SquarePen } from 'lucide-react';
import { useState } from 'react';
import { destinations, pinned, projects, settingsNav, settingsSections, usage, type Session, type SessionState } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import s from './desktop.module.css';
import { MenuItem, Popover, Ring, Spinner, sceneHref, useMenu } from './ui';

const destinationIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

const stateWord: Record<SessionState, string> = {
  running: 'Running',
  approval: 'Needs your approval',
  question: 'Asked you a question',
  plan: 'Plan to review',
  unread: 'Unread',
  idle: '',
};

export const needsYou = (state: SessionState) => state === 'approval' || state === 'question' || state === 'plan';

export function StateMark({ state }: { state: SessionState }) {
  if (state === 'running') return <Spinner size={13} />;
  if (needsYou(state)) return <span className={s.dotNeeds} />;
  if (state === 'unread') return <span className={s.dotUnread} />;
  return null;
}

function SessionRow({ session, selected }: { session: Session; selected: boolean }) {
  const waits = needsYou(session.state);
  const hint = [session.line, session.branch, session.machine && `on ${session.machine}`, session.age].filter(Boolean).join(' · ');
  return (
    <button type="button" className={s.row} data-selected={selected || undefined} data-state={session.state} data-tall={waits || undefined} title={hint}>
      <span className={s.rowMark}>
        <StateMark state={session.state} />
      </span>
      <span className={s.rowText}>
        <span className={s.rowTop}>
          <span className={s.rowTitle}>{session.title}</span>
          {session.machine && <span className={s.rowWhere}>{session.machine}</span>}
          <span className={s.rowMeta}>{session.age}</span>
        </span>
        {waits && <span className={s.rowLine}>{session.line}</span>}
      </span>
      {stateWord[session.state] && <span className={s.sr}>{stateWord[session.state]}</span>}
    </button>
  );
}

function Sessions({ scene, resolved }: { scene: SceneId; resolved: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(projects.map((p) => [p.id, p.open])));
  const settle = (x: Session): Session => (resolved && x.state === 'approval' ? { ...x, state: 'running', line: 'Pushing fix/upload-retry' } : x);
  return (
    <>
      <div className={s.group}>
        {destinations.map((d) => {
          const Icon = destinationIcon[d.icon];
          const current = d.id === 'new' && scene === 'home';
          const body = (
            <>
              <span className={s.rowMark}>
                <Icon size={15} strokeWidth={1.7} />
              </span>
              <span className={s.rowText}>
                <span className={s.rowTitle}>{d.label}</span>
              </span>
              {'shortcut' in d && <span className={s.rowMeta}>{d.shortcut}</span>}
            </>
          );
          return d.id === 'new' ? (
            <a key={d.id} className={s.row} data-selected={current || undefined} href={sceneHref('home')}>
              {body}
            </a>
          ) : (
            <button key={d.id} type="button" className={s.row}>
              {body}
            </button>
          );
        })}
      </div>
      <div className={s.group}>
        <div className={s.heading}>Pinned</div>
        {pinned.map((x) => (
          <SessionRow key={x.id} session={x} selected={false} />
        ))}
      </div>
      {projects.map((p) => (
        <div className={s.group} key={p.id}>
          <button type="button" className={s.heading} data-open={open[p.id] || undefined} aria-expanded={open[p.id]} onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>
            <span>{p.name}</span>
            <ChevronRight size={12} strokeWidth={2} className={s.headingChevron} />
          </button>
          <div className={s.fold} data-open={open[p.id] || undefined}>
            <div className={s.foldInner}>
              {p.sessions.map((x) => (
                <SessionRow key={x.id} session={settle(x)} selected={scene === 'session' && x.id === 's1'} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function SettingsNav({ section, onSection }: { section: string; onSection: (id: string) => void }) {
  const drawn = new Set(settingsSections.map((x) => x.title));
  return (
    <>
      <div className={s.group}>
        <a className={s.row} data-back href={sceneHref('session')}>
          <span className={s.rowMark}>
            <ChevronLeft size={15} strokeWidth={1.9} />
          </span>
          <span className={s.rowText}>
            <span className={s.rowTitle}>Settings</span>
          </span>
        </a>
      </div>
      <div className={s.group}>
        {settingsNav.map((name) => {
          const id = name.toLowerCase();
          const has = drawn.has(name);
          return (
            <button
              key={name}
              type="button"
              className={s.row}
              data-plain
              data-selected={section === id || undefined}
              aria-disabled={!has || undefined}
              title={has ? undefined : 'Not drawn in this experiment'}
              onClick={() => has && onSection(id)}
            >
              <span className={s.rowText}>
                <span className={s.rowTitle}>{name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function Pane({
  scene,
  resolved,
  section,
  onSection,
}: {
  scene: SceneId;
  resolved: boolean;
  section: string;
  onSection: (id: string) => void;
}) {
  const menu = useMenu();
  return (
    <nav className={s.pane} aria-label="Sidebar">
      <div className={s.paneBand} />
      <div className={s.paneScroll}>{scene === 'settings' ? <SettingsNav section={section} onSection={onSection} /> : <Sessions scene={scene} resolved={resolved} />}</div>
      <div className={s.paneFoot}>
        <button
          type="button"
          className={s.iconButton}
          aria-label={`Usage: ${percent(usage.fiveHour)} of the five-hour limit, ${percent(usage.week)} of the week`}
          aria-haspopup="dialog"
          aria-expanded={menu.id === 'usage'}
          onClick={(e) => menu.toggle('usage', e.currentTarget)}
        >
          <Ring size={20} stroke={2.4} value={usage.week} inner={usage.fiveHour} />
        </button>
        {scene !== 'settings' && (
          <a className={s.iconButton} href={sceneHref('settings')} aria-label="Settings" title="Settings">
            <Settings size={15} strokeWidth={1.7} />
          </a>
        )}
        <Popover id="usage" place="above-start" width={232} label="Usage" role="dialog">
          <div className={s.usage}>
            <Ring size={30} stroke={3.4} value={usage.fiveHour} />
            <div>
              <div className={s.usageLine}>
                <span>Five hours</span>
                <b>{percent(usage.fiveHour)}</b>
              </div>
              <div className={s.usageNote}>Resets in {usage.resetsIn}</div>
            </div>
          </div>
          <div className={s.usage}>
            <Ring size={30} stroke={3.4} value={usage.week} />
            <div>
              <div className={s.usageLine}>
                <span>This week</span>
                <b>{percent(usage.week)}</b>
              </div>
            </div>
          </div>
          {scene !== 'settings' && (
            <>
              <div className={s.menuRule} />
              <MenuItem href={sceneHref('settings')}>Settings</MenuItem>
            </>
          )}
        </Popover>
      </div>
    </nav>
  );
}
