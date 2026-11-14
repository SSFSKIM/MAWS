import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { settingsNav, settingsSections, type Setting } from '../../content/fixtures';
import { Fold, Segmented, Switch, ToggleChip } from './bits';

function Control({ s }: { s: Setting }) {
  const c = s.control;
  const [bool, setBool] = useState(c.type === 'switch' ? c.on : false);
  const [value, setValue] = useState(c.type === 'segmented' || c.type === 'select' || c.type === 'text' ? c.value : '');
  switch (c.type) {
    case 'switch':
      return <Switch on={bool} onChange={setBool} label={s.label} />;
    case 'segmented':
      return <Segmented options={c.options} value={value} onChange={setValue} label={s.label} />;
    case 'select':
      return (
        <span className="xf-select">
          <select aria-label={s.label} value={value} onChange={(e) => setValue(e.target.value)}>
            {c.options.map((o) => <option key={o}>{o}</option>)}
          </select>
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      );
    case 'text':
      return <input className="xf-input" data-mono={!!c.mono} aria-label={s.label} value={value} placeholder={c.placeholder} onChange={(e) => setValue(e.target.value)} spellCheck={false} />;
    case 'path':
      return (
        <span className="xf-path">
          <code>{c.value}</code>
          {c.badge && c.badge !== c.value.split('/').pop() && <span className="xf-badge">{c.badge}</span>}
          {c.action && <button type="button" className="xf-btn">{c.action}</button>}
        </span>
      );
    case 'button':
      return <button type="button" className="xf-btn">{c.label}</button>;
    case 'checks':
    case 'switches':
      return <div className="xf-chips">{c.items.map((i) => <ToggleChip key={i.label} label={i.label} on={i.on} />)}</div>;
  }
}

function Row({ s }: { s: Setting }) {
  const [open, setOpen] = useState(false);
  const wide = s.control.type === 'checks' || s.control.type === 'switches';
  return (
    <div className="xf-set" data-wide={wide}>
      {s.help ? (
        <button type="button" className="xf-set-label" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span>{s.label}</span>
          <Info className="xf-info" size={14} strokeWidth={1.9} aria-hidden="true" />
        </button>
      ) : (
        <div className="xf-set-label"><span>{s.label}</span></div>
      )}
      <div className="xf-set-control"><Control s={s} /></div>
      {s.help && (
        <div className="xf-set-help">
          <Fold open={open}><p>{s.help}</p></Fold>
        </div>
      )}
    </div>
  );
}

export function SettingsBody() {
  const [current, setCurrent] = useState('Engine');
  const has = (name: string) => settingsSections.some((s) => s.title === name);
  return (
    <div className="xf-settings">
      <div className="xf-settings-grid">
      <nav className="xf-settings-nav" aria-label="Settings sections">
        {settingsNav.map((n) => (
          <button
            key={n}
            type="button"
            aria-current={n === current ? 'true' : undefined}
            onClick={() => {
              setCurrent(n);
              if (has(n)) document.getElementById(`xf-set-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {n}
          </button>
        ))}
      </nav>
        <div className="xf-settings-col">
          {settingsSections.map((sec) => (
            <section key={sec.id} id={`xf-set-${sec.title}`}>
              <h2>{sec.title}</h2>
              <div className="xf-set-group">
                {sec.settings.map((s) => <Row key={s.label} s={s} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
