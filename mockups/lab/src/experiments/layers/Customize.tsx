// The Customize page (DESIGN.md section 21): what Claude has been given in one place. The app spreads this over
// three tabs, two views each and a row of filters; here it is one column of lines on the field (plugins, the app's
// own mods, skills, connectors), each opening into a sheet of glass, with the catalog behind one round button.
// A line's mark is its exception, never its normal state: a problem, an update, a sign-in that is the person's to do.
import { useCallback, useState, type ReactNode } from 'react';
import { BadgeCheck, Check, ChevronDown, CircleArrowUp, Folder, KeyRound, Plus, RotateCw, Store, Terminal, Trash2, TriangleAlert, User } from 'lucide-react';
import { customize, type Plugin } from '../../content/fixtures';
import { Pop } from './parts';
import { Facts, Find, Line, Plus1 } from './Shelf';

const SCOPE = { user: 'Yours, everywhere', project: 'This project', local: 'This project, only you' } as const;

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="xl-switch" onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="xl-o-group" aria-label={title}>
      <h3 className="xl-o-head">{title}</h3>
      {children}
    </section>
  );
}

const Alert = ({ tip }: { tip: string }) => (
  <span className="xl-s-flag" role="img" aria-label={tip} data-tip={tip} data-tip-at="above-start">
    <TriangleAlert size={15} strokeWidth={1.9} />
  </span>
);

function PluginInside({ p }: { p: Plugin }) {
  const runs = p.hooks || p.servers?.some((s) => s.local);
  return (
    <>
      {p.problem && (
        <p className="xl-s-say">
          <TriangleAlert size={14} strokeWidth={1.9} />
          {p.problem}. {customize.session} is running without it.
        </p>
      )}
      <p className="xl-s-about">{p.about}</p>
      <div className="xl-s-chips">
        {p.skills.map((s) => (
          <span key={s} className="xl-s-chip" data-mono="">
            /{s}
          </span>
        ))}
        {p.commands && <span className="xl-s-chip">{p.commands} commands</span>}
        {p.agents && <span className="xl-s-chip">{p.agents === 1 ? '1 agent' : `${p.agents} agents`}</span>}
        {p.servers?.map((s) => (
          <span key={s.name} className="xl-s-chip">
            Connector: {s.name}
          </span>
        ))}
        {p.hooks && <span className="xl-s-chip">Hooks</span>}
      </div>
      <Facts>
        <span>{p.version}</span>
        <span>{p.by}</span>
        <span>{SCOPE[p.scope]}</span>
        {p.verified && (
          <span>
            <BadgeCheck size={13} strokeWidth={1.75} />
            Reviewed
          </span>
        )}
        {runs && (
          <span>
            <Terminal size={13} strokeWidth={1.75} />
            Runs code on this Mac
          </span>
        )}
      </Facts>
      <div className="xl-s-acts">
        <button type="button" className="xl-icon" aria-label={`Uninstall ${p.name}`} data-tip="Uninstall" data-tip-at="above-start">
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
        <span className="xl-grow" />
        {p.update && (
          <button type="button" className="xl-btn" data-kind="go">
            Update to {p.update}
          </button>
        )}
      </div>
    </>
  );
}

export type SkillsForm = 'inside' | 'listed';

export function CustomizePage({ skills, empty, first }: { skills: SkillsForm; empty: boolean; first?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(first ?? null);
  const [place, setPlace] = useState(customize.place);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries([...customize.plugins.map((p) => [p.name, p.on]), ...customize.mods.map((m) => [m.name, m.on])]));
  const [inSession, setInSession] = useState<Record<string, string>>(() => Object.fromEntries(customize.mods.map((m) => [m.name, m.inSession])));
  const [signedIn, setSignedIn] = useState(false);
  const q = query.trim().toLowerCase();
  const hit = (...words: string[]) => !q || words.some((w) => w.toLowerCase().includes(q));
  const toggle = (id: string) => setOpen(open === id ? null : id);

  // A search for a skill finds the plugin that brings it.
  const plugins = empty ? [] : customize.plugins.filter((p) => hit(p.name, p.about, ...p.skills));
  const mods = empty ? [] : customize.mods.filter((m) => hit(m.name, m.about));
  const own = empty ? [] : customize.skills.filter((s) => hit(s.name, s.about));
  const brought = empty || skills !== 'listed' ? [] : customize.plugins.flatMap((p) => p.skills.map((s) => ({ name: s, from: p.name }))).filter((s) => hit(s.name, s.from));
  const connectors = empty ? [] : customize.connectors.filter((c) => hit(c.name, c.about));
  const nothing = plugins.length + mods.length + own.length + brought.length + connectors.length === 0;

  return (
    <div className="xl-items xl-board xl-shelf">
      <Find words="Search what Claude can use" value={query} onChange={setQuery}>
        <button type="button" ref={setEl} className="xl-chip xl-s-place" aria-expanded={menu} aria-label={`Showing ${place}`} onClick={() => setMenu((v) => !v)}>
          {place === customize.places[0] ? <User size={14} strokeWidth={1.75} /> : <Folder size={14} strokeWidth={1.75} />}
          {place}
          <ChevronDown size={13} strokeWidth={2} />
        </button>
      </Find>
      <Pop open={menu} anchor={el} place="below-end" onClose={close} label="Whose configuration">
        {customize.places.map((name, i) => (
          <button
            key={name}
            type="button"
            className="xl-item"
            onClick={() => {
              setPlace(name);
              close();
            }}
          >
            {i === 0 ? <User size={15} strokeWidth={1.75} /> : <Folder size={15} strokeWidth={1.75} />}
            <span>{name}</span>
            {name === place && <Check size={14} strokeWidth={2} />}
          </button>
        ))}
      </Pop>

      {nothing && <p className="xl-s-none">{empty ? 'Nothing added here yet.' : `Nothing matches “${query.trim()}”.`}</p>}

      {plugins.length > 0 && (
        <Group title="Plugins">
          {plugins.map((p) => (
            <Line
              key={p.name}
              label={p.name}
              open={open === p.name}
              onToggle={() => toggle(p.name)}
              weight={on[p.name] ? undefined : 'rest'}
              mark={
                p.problem ? (
                  <Alert tip={p.problem} />
                ) : p.update ? (
                  <span className="xl-s-flag" role="img" aria-label={`Version ${p.update} is out`} data-tip={`${p.update} is out`} data-tip-at="above-start">
                    <CircleArrowUp size={15} strokeWidth={1.75} />
                  </span>
                ) : undefined
              }
              title={p.name}
              badge={p.isNew ? <i className="xl-dot xl-s-new" role="img" aria-label="New" /> : undefined}
              line={p.about}
              end={<Switch on={!!on[p.name]} label={`${p.name} in new sessions`} onChange={(v) => setOn({ ...on, [p.name]: v })} />}
            >
              <PluginInside p={p} />
            </Line>
          ))}
        </Group>
      )}

      {mods.length > 0 && (
        <Group title="Built in">
          {mods.map((m) => (
            <Line
              key={m.name}
              label={m.name}
              open={open === m.name}
              onToggle={() => toggle(m.name)}
              weight={on[m.name] ? undefined : 'rest'}
              title={m.name}
              line={m.about}
              end={<Switch on={!!on[m.name]} label={`${m.name} in every session`} onChange={(v) => setOn({ ...on, [m.name]: v })} />}
            >
              <p className="xl-s-about">{m.about}</p>
              <div className="xl-s-pick">
                <span>In {customize.session}</span>
                <div className="xl-opts" role="radiogroup" aria-label={`${m.name} in ${customize.session}`}>
                  {(['default', 'on', 'off'] as const).map((v) => (
                    <button key={v} type="button" className="xl-opt" role="radio" aria-checked={inSession[m.name] === v} aria-pressed={inSession[m.name] === v} onClick={() => setInSession({ ...inSession, [m.name]: v })}>
                      {v === 'default' ? `As everywhere (${on[m.name] ? 'on' : 'off'})` : v === 'on' ? 'On' : 'Off'}
                    </button>
                  ))}
                </div>
              </div>
              <Facts>
                <span>Version {m.version}</span>
                <span>Part of the app</span>
              </Facts>
            </Line>
          ))}
        </Group>
      )}

      {own.length + brought.length > 0 && (
        <Group title="Skills">
          {own.map((s) => (
            <Line key={s.name} label={s.name} open={open === s.name} onToggle={() => toggle(s.name)} title={s.name} line={s.about} end={<span className="xl-o-meta" />}>
              <p className="xl-s-about">{s.about}</p>
              <div className="xl-s-chips">
                <span className="xl-s-chip" data-mono="">
                  /{s.name}
                </span>
              </div>
              <Facts>
                <span>Your own</span>
                <span>{SCOPE[s.scope]}</span>
              </Facts>
              <div className="xl-s-acts">
                <button type="button" className="xl-icon" aria-label={`Remove ${s.name}`} data-tip="Remove" data-tip-at="above-start">
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
              </div>
            </Line>
          ))}
          {brought.map((s) => (
            <Line
              key={`${s.from}/${s.name}`}
              label={s.name}
              open={open === `${s.from}/${s.name}`}
              onToggle={() => toggle(`${s.from}/${s.name}`)}
              weight={on[s.from] ? undefined : 'rest'}
              title={s.name}
              line=""
              end={
                <span className="xl-o-meta">
                  <span>{s.from}</span>
                </span>
              }
            >
              <div className="xl-s-chips">
                <span className="xl-s-chip" data-mono="">
                  /{s.name}
                </span>
              </div>
              <Facts>
                <span>From {s.from}</span>
              </Facts>
            </Line>
          ))}
        </Group>
      )}

      {connectors.length > 0 && (
        <Group title="Connectors">
          {connectors.map((c) => {
            const state = c.state === 'signin' && signedIn ? 'connected' : c.state;
            return (
              <Line
                key={c.name}
                label={c.name}
                open={open === c.name}
                onToggle={() => toggle(c.name)}
                mark={
                  state === 'signin' ? (
                    <span className="xl-glyph" data-kind="yours" role="img" aria-label="Sign in needed">
                      <KeyRound size={15} strokeWidth={2} />
                    </span>
                  ) : state === 'failed' ? (
                    <Alert tip={c.failed ?? 'Failed'} />
                  ) : state === 'connecting' ? (
                    <span className="xl-glyph" role="img" aria-label="Connecting">
                      <i className="xl-dot" data-run="" />
                    </span>
                  ) : undefined
                }
                title={c.name}
                line={c.about}
                end={
                  state === 'signin' ? (
                    <button type="button" className="xl-btn xl-s-do" data-kind="go" onClick={() => setSignedIn(true)}>
                      Sign in
                    </button>
                  ) : state === 'failed' ? (
                    <button type="button" className="xl-icon" aria-label={`Try ${c.name} again`} data-tip="Try again" data-tip-at="end">
                      <RotateCw size={15} strokeWidth={1.75} />
                    </button>
                  ) : (
                    <span className="xl-o-meta" />
                  )
                }
              >
                {state === 'failed' && (
                  <p className="xl-s-say">
                    <TriangleAlert size={14} strokeWidth={1.9} />
                    {c.failed}.
                  </p>
                )}
                <div className="xl-ask-cmd">{c.where}</div>
                {(state === 'connected' || state === 'open') && c.tools.length > 0 && (
                  <div className="xl-s-chips">
                    {c.tools.map((t) => (
                      <span key={t} className="xl-s-chip" data-mono="">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <Facts>
                  <span>{c.transport}</span>
                  <span>{SCOPE[c.scope]}</span>
                  <span>{state === 'open' ? 'No sign-in needed' : state === 'connected' ? 'Signed in' : state === 'signin' ? 'Sign in needed' : state === 'connecting' ? 'Connecting' : 'Not connected'}</span>
                </Facts>
                <div className="xl-s-acts">
                  <button type="button" className="xl-icon" aria-label={`Remove ${c.name}`} data-tip="Remove" data-tip-at="above-start">
                    <Trash2 size={15} strokeWidth={1.75} />
                  </button>
                </div>
              </Line>
            );
          })}
        </Group>
      )}
    </div>
  );
}

/** The catalog, behind one button: its search, and what its sources put first. */
export function Discover({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [added, setAdded] = useState<string[]>([]);
  return (
    <Plus1 open={open} onToggle={onToggle} icon={<Plus size={17} strokeWidth={1.75} />} words={{ show: 'Add', hide: 'Close' }} label="Add">
      <section className="xl-part" aria-label="Discover">
        <h3 className="xl-module-head">Discover</h3>
        {/* The field is there while the card is: a closed card keeps no field waiting out of sight. */}
        {open && <input className="xl-input xl-s-seek" placeholder="Search all sources" aria-label="Search all sources" />}
        {customize.discover.map((d) => (
          <div key={d.name} className="xl-line xl-s-found" data-top="">
            <span className="xl-line-text">
              <span className="xl-s-found-name">
                {d.name}
                {d.trust === 'verified' && (
                  <span role="img" aria-label="Reviewed" data-tip="Reviewed" data-tip-at="above-start">
                    <BadgeCheck size={13} strokeWidth={1.75} />
                  </span>
                )}
                {d.runsCode && (
                  <span role="img" aria-label="Runs code on this Mac" data-tip="Runs code on this Mac" data-tip-at="above-start">
                    <Terminal size={13} strokeWidth={1.75} />
                  </span>
                )}
              </span>
              <span className="xl-line-sub">{d.about}</span>
            </span>
            {added.includes(d.name) ? (
              <span className="xl-s-added" role="img" aria-label="Added">
                <Check size={15} strokeWidth={2} />
              </span>
            ) : (
              <button type="button" className="xl-icon" aria-label={`Add ${d.name}`} data-tip="Add" data-tip-at="above-end" onClick={() => setAdded([...added, d.name])}>
                <Plus size={16} strokeWidth={1.75} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="xl-line xl-s-all">
          <Store size={14} strokeWidth={1.75} />
          <span className="xl-line-text">Everything, and its sources</span>
        </button>
      </section>
    </Plus1>
  );
}
