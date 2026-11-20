import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Info } from 'lucide-react';
import { settingsNav, settingsSections, type Setting, type SettingControl } from '../../content/fixtures';
import { Glass, useShell } from './shell';
import { TopBar } from './TopBar';

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return <button role="switch" aria-checked={v} aria-label={label} className="x-windows-switch" onClick={() => setV(!v)} />;
}

/** A segmented control whose thumb is one object that travels, never two that cross-fade. */
function Segmented({ options, value, label }: { options: string[]; value: string; label: string }) {
  const [v, setV] = useState(value);
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = track.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    place();
    void document.fonts.ready.then(place);
  }, [v]);
  return (
    <div className="x-windows-seg" role="radiogroup" aria-label={label} ref={track}>
      {thumb && <span className="x-windows-seg-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />}
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === v} onClick={() => setV(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, on, role }: { label: string; on: boolean; role: 'checkbox' | 'switch' }) {
  const [v, setV] = useState(on);
  return (
    <button role={role} aria-checked={v} className="x-windows-toggle" onClick={() => setV(!v)}>
      <i>
        <Check size={10} strokeWidth={4} />
      </i>
      {label}
    </button>
  );
}

function Select({ options, value, label }: { options: string[]; value: string; label: string }) {
  const [v, setV] = useState(value);
  return (
    <button className="x-windows-select" aria-label={`${label}: ${v}`} onClick={() => setV(options[(options.indexOf(v) + 1) % options.length]!)}>
      {v}
      <ChevronsUpDown size={13} strokeWidth={2.4} />
    </button>
  );
}

function Control({ c, label }: { c: SettingControl; label: string }) {
  switch (c.type) {
    case 'switch':
      return <Switch on={c.on} label={label} />;
    case 'segmented':
      return <Segmented options={c.options} value={c.value} label={label} />;
    case 'select':
      return <Select options={c.options} value={c.value} label={label} />;
    case 'text':
      return <input className={`x-windows-field ${c.mono ? 'x-windows-mono' : ''}`} defaultValue={c.value} placeholder={c.placeholder} aria-label={label} spellCheck={false} />;
    case 'path': {
      // A long path is not something to read at rest: its badge stands for it, and the path opens with the help.
      const long = c.value.length > 24;
      return (
        <span className="x-windows-path">
          {!long && <span className="x-windows-mono">{c.value}</span>}
          {c.badge && <span className="x-windows-badge x-windows-num">{c.badge}</span>}
          {c.action && <button className="x-windows-soft">{c.action}</button>}
        </span>
      );
    }
    case 'button':
      return <button className="x-windows-soft">{c.label}</button>;
    case 'checks':
      return (
        <span className="x-windows-toggles" role="group" aria-label={label}>
          {c.items.map((i) => (
            <Toggle key={i.label} label={i.label} on={i.on} role="checkbox" />
          ))}
        </span>
      );
    case 'switches':
      return (
        <span className="x-windows-toggles" role="group" aria-label={label}>
          {c.items.map((i) => (
            <Toggle key={i.label} label={i.label} on={i.on} role="switch" />
          ))}
        </span>
      );
  }
}

/** One setting: its name and its control. The sentence the app prints under it today waits behind the mark. */
function Row({ s, startOpen }: { s: Setting; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="x-windows-set-row">
      <div className="x-windows-set-line">
        <span className="x-windows-set-label">
          {s.label}
          {s.help && (
            <button className="x-windows-set-why" aria-expanded={open} aria-label={`About ${s.label}`} onClick={() => setOpen((v) => !v)}>
              <Info size={14} strokeWidth={2.4} />
            </button>
          )}
        </span>
        <span className="x-windows-set-ctl">
          <Control c={s.control} label={s.label} />
        </span>
      </div>
      {s.help && (
        <div className="x-windows-fold" data-open={open}>
          <div>
            <p className="x-windows-set-help">
              {s.control.type === 'path' && s.control.value.length > 24 && <span className="x-windows-mono x-windows-set-path">{s.control.value}</span>}
              {s.help}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function Settings() {
  const shell = useShell();
  const [current, setCurrent] = useState('Engine');
  const scroller = useRef<HTMLDivElement>(null);
  const has = (name: string) => settingsSections.some((s) => s.title === name);
  const go = (name: string) => {
    setCurrent(name);
    scroller.current?.querySelector(`[data-section="${name}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // The list follows the page as it scrolls.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => {
      const secs = [...el.querySelectorAll<HTMLElement>('[data-section]')];
      const top = el.getBoundingClientRect().top + 80;
      const at = secs.filter((s) => s.getBoundingClientRect().top <= top).pop() ?? secs[0];
      if (at?.dataset.section) setCurrent(at.dataset.section);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  return (
    <>
      <TopBar mode="settings" />
      <Glass id="x-windows-page" role="window" label="Settings" className="x-windows-page" radius={28}>
        <div className="x-windows-set">
          <nav className="x-windows-set-nav" aria-label="Settings sections">
            <h2>Settings</h2>
            {settingsNav.map((n) => (
              <button key={n} className="x-windows-row" aria-current={n === current ? 'true' : undefined} data-empty={!has(n)} onClick={() => go(n)}>
                {n}
              </button>
            ))}
          </nav>
          <div className="x-windows-set-main">
            <div className="x-windows-scroll" ref={scroller}>
              <div className="x-windows-set-col">
                {settingsSections.map((sec) => (
                  <section key={sec.id} className="x-windows-set-sec" data-section={sec.title} aria-label={sec.title}>
                    <h3>{sec.title}</h3>
                    <div className="x-windows-set-card">
                      {sec.settings.map((s, i) => (
                        <Row key={s.label} s={s} startOpen={shell.flag('help') && sec.id === 'engine' && i === 0} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Glass>
    </>
  );
}
