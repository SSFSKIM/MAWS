// The Overview: every live or unread session, across projects, and the ones that wait answered without opening
// them (DESIGN.md section 18). The session page's rule is kept and read at a larger number: what is the agents'
// business is a line on the field, as prose is, and the page's one piece of glass holds what is the person's to
// answer. That glass is the waiting capsule's list standing open where the side column stands on a session, so the
// capsule itself is not drawn here; the orange discs are all in it, and nowhere else on the page.
import { useRef } from 'react';
import { ArrowUpRight, GitBranch, Monitor } from 'lucide-react';
import { fleet, type Session, type SessionState } from '../../content/fixtures';
import { useGlassUnder } from './glass';
import { Remote, useNeeds } from './needs';
import { isYours, StateGlyph } from './parts';
import { WaitItems } from './Session';
import { Block } from './Transcript';

export type Grouping = 'state' | 'project';
export type BoardForm = 'rows' | 'cards';

/** What comes first when it is not the person's move: what finished and is unread, what works, what rests. */
const ORDER: SessionState[] = ['unread', 'running', 'idle'];

interface Entry {
  s: Session;
  project: string;
}

function groupsOf(live: (s: Session) => Session, by: Grouping, withYours: boolean): { id: string; title?: string; list: Entry[] }[] {
  const all: Entry[] = fleet.flatMap((p) => p.sessions.map((s) => ({ s: live(s), project: p.name })));
  const rest = all.filter((e) => !isYours(e.s.state));
  const yours = withYours ? [{ id: 'yours', list: all.filter((e) => isYours(e.s.state)) }] : [];
  const groups =
    by === 'state'
      ? ORDER.map((state) => ({ id: state, list: rest.filter((e) => e.s.state === state) }))
      : fleet.map((p) => ({ id: p.id, title: p.name, list: rest.filter((e) => e.project === p.name).sort((a, b) => ORDER.indexOf(a.s.state) - ORDER.indexOf(b.s.state)) }));
  return [...yours, ...groups].filter((g) => g.list.length > 0);
}

/** What a run of lines is, said aloud; on screen its glyphs say it. */
const RUN: Record<string, string> = { yours: 'Waiting for you', unread: 'Finished, not read yet', running: 'Working', idle: 'At rest' };

const weightOf = (s: Session) => (s.state === 'unread' ? 'unread' : s.state === 'idle' ? 'rest' : undefined);

/**
 * The main column: one line a session, read on the field. A line is its state's glyph, its title, what it is doing
 * or what it ended on, and how long ago; where it runs waits for the pointer. Grouped by state the groups need no
 * heading, because the glyph column is one: solid dots, breathing dots, none.
 */
export function Board({ live, by, form }: { live: (s: Session) => Session; by: Grouping; form: BoardForm }) {
  const needs = useNeeds();
  const cards = form === 'cards';
  const groups = groupsOf(live, by, cards);
  return (
    <div className="xl-items xl-board" data-form={form} data-by={by}>
      {groups.map((g) => (
        <section key={g.id} className="xl-o-group" aria-label={g.title ?? RUN[g.id]}>
          {g.title && <h3 className="xl-o-head">{g.title}</h3>}
          <div className="xl-o-list">
            {g.list.map(({ s, project }) =>
              cards ? (
                <Card key={s.id} s={s} project={by === 'state' || g.id === 'yours' ? project : undefined} onOpen={() => needs.open(s.id)} />
              ) : (
                <button key={s.id} type="button" className="xl-o-row" data-weight={weightOf(s)} onClick={() => needs.open(s.id)}>
                  <span className="xl-o-mark">
                    <StateGlyph state={s.state} />
                  </span>
                  <span className="xl-o-title">{s.title}</span>
                  <span className="xl-o-line">{s.line}</span>
                  <span className="xl-o-end">
                    <span className="xl-o-meta">
                      {by === 'state' && <span className="xl-o-where">{project}</span>}
                      <span className="xl-o-age">{s.age}</span>
                    </span>
                    <span className="xl-o-more">
                      {by === 'state' && <span className="xl-o-where">{project}</span>}
                      {s.branch && (
                        <span>
                          <GitBranch size={12} strokeWidth={1.75} />
                          {s.branch}
                        </span>
                      )}
                      {s.machine && (
                        <span>
                          <Monitor size={12} strokeWidth={1.75} />
                          {s.machine}
                        </span>
                      )}
                      <ArrowUpRight size={15} strokeWidth={1.9} />
                    </span>
                  </span>
                </button>
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The other form (the Sessions switch): every session a card of glass, the waiting ones holding their answer. */
function Card({ s, project, onOpen }: { s: Session; project?: string; onOpen: () => void }) {
  const yours = isYours(s.state);
  return (
    <Block className="xl-o-card" radius={20}>
      <div className="xl-o-card-in" data-weight={weightOf(s)}>
        <button type="button" className="xl-o-card-head" onClick={onOpen}>
          <StateGlyph state={s.state} />
          <span className="xl-o-card-text">
            <span className="xl-card-title">{s.title}</span>
            {(s.state === 'approval' || !yours) && <span className="xl-card-line">{s.line}</span>}
          </span>
        </button>
        {yours && <Remote session={s} />}
        <div className="xl-card-meta">
          {project && <span>{project}</span>}
          {s.branch && (
            <span>
              <GitBranch size={12} strokeWidth={1.75} />
              {s.branch}
            </span>
          )}
          {s.machine && (
            <span>
              <Monitor size={12} strokeWidth={1.75} />
              {s.machine}
            </span>
          )}
          <span>{s.age}</span>
        </div>
      </div>
    </Block>
  );
}

/**
 * What waits for the person, where the side column stands on a session: one piece of glass, the capsule's own list
 * standing open. One item is open at a time and holds what that session's composer holds; answered, it leaves, and
 * when nothing waits the glass leaves with it and the lines take the room.
 */
export function Yours({ waiting, first }: { waiting: Session[]; first?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlassUnder(ref, { radius: 22 });
  return (
    <aside className="xl-yours" aria-label="Waiting for you">
      <div ref={ref} className="xl-module xl-yours-card">
        <WaitItems waiting={waiting} first={first} />
      </div>
    </aside>
  );
}
