import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { settingsNav, settingsSections, type Setting, type SettingControl } from '../../content/fixtures';

function Switch({ on: initial, label }: { on: boolean; label: string }) {
  const [on, setOn] = useState(initial);
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => setOn((v) => !v)}>
      <i />
    </button>
  );
}

function Segmented({ options, value: initial, label }: { options: string[]; value: string; label: string }) {
  const [value, setValue] = useState(initial);
  const index = Math.max(0, options.indexOf(value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ ['--n' as string]: options.length, ['--at' as string]: index }}>
      <i className="seg-thumb" aria-hidden />
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o === value} key={o} onClick={() => setValue(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Toggles({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className="toggles">
      {items.map((item, i) => (
        <button type="button" className="toggle-chip" aria-pressed={on[i]} key={item.label} onClick={() => setOn((v) => v.map((x, j) => (j === i ? !x : x)))}>
          <Check className="toggle-check" size={12} strokeWidth={3} aria-hidden />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Control({ c, label }: { c: SettingControl; label: string }) {
  switch (c.type) {
    case 'switch':
      return <Switch on={c.on} label={label} />;
    case 'segmented':
      return <Segmented options={c.options} value={c.value} label={label} />;
    case 'select':
      return (
        <button type="button" className="pill select" aria-label={label}>
          {c.value}
          <ChevronDown className="pill-caret" size={13} strokeWidth={2.2} aria-hidden />
        </button>
      );
    case 'text':
      return <input className={c.mono ? 'field-input mono' : 'field-input'} defaultValue={c.value} placeholder={c.placeholder} aria-label={label} spellCheck={false} />;
    case 'path':
      return (
        <span className="path-ctl">
          <code>
            <bdi>{c.value}</bdi>
          </code>
          {c.badge && !c.value.endsWith(c.badge) && <span className="badge">{c.badge}</span>}
          {c.action && (
            <button type="button" className="btn quiet small">
              {c.action}
            </button>
          )}
        </span>
      );
    case 'button':
      return (
        <button type="button" className="btn quiet small">
          {c.label}
        </button>
      );
    case 'checks':
    case 'switches':
      return <Toggles items={c.items} />;
  }
}

function Row({ s }: { s: Setting }) {
  const wide = s.control.type === 'checks' || s.control.type === 'switches';
  return (
    <div className="set-row" data-wide={wide} data-help={!!s.help}>
      <span className="set-label">{s.label}</span>
      <span className="set-ctl">
        <Control c={s.control} label={s.label} />
      </span>
      {s.help && <p className="set-help">{s.help}</p>}
    </div>
  );
}

export function SettingsScene() {
  const [at, setAt] = useState('Engine');
  const has = new Set(settingsSections.map((s) => s.title));
  return (
    <div className="settings">
      <nav className="set-nav" aria-label="Settings sections">
        <h1>Settings</h1>
        {settingsNav.map((n) => (
          <a
            key={n}
            href={has.has(n) ? `#set-${n.toLowerCase()}` : undefined}
            aria-current={n === at ? 'true' : undefined}
            onClick={(e) => {
              e.preventDefault();
              setAt(n);
              document.getElementById(`set-${n.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {n}
          </a>
        ))}
      </nav>
      <div
        className="set-scroll"
        onScroll={(e) => {
          // The index follows the page: the last section whose heading has passed the top.
          const top = e.currentTarget.getBoundingClientRect().top + 48;
          let current = settingsSections[0]!.title;
          for (const sec of settingsSections) {
            const el = document.getElementById(`set-${sec.id}`);
            if (el && el.getBoundingClientRect().top <= top) current = sec.title;
          }
          setAt(current);
        }}
      >
        <div className="set-col">
          {settingsSections.map((sec) => (
            <section key={sec.id} id={`set-${sec.id}`} aria-labelledby={`set-h-${sec.id}`}>
              <h2 id={`set-h-${sec.id}`}>{sec.title}</h2>
              <div className="set-card">
                {sec.settings.map((s) => (
                  <Row s={s} key={s.label} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
