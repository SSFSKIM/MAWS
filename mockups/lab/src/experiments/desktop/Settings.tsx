// The settings page as a Mac's grouped form: a label, its control, and nothing printed under it. What the app
// prints under each setting today waits behind a round "?" that shows when the row is pointed at or focused.
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { settingsSections, type Setting, type SettingControl } from '../../content/fixtures';
import s from './desktop.module.css';
import { CheckGlyph, MenuItem, Popover, Segmented, Switch, useMenu } from './ui';

function Help({ id, text, extra }: { id: string; text: string; extra?: string }) {
  const menu = useMenu();
  return (
    <>
      <button type="button" className={s.help} aria-label="What this does" aria-expanded={menu.id === id} onClick={(e) => menu.toggle(id, e.currentTarget)}>
        ?
      </button>
      <Popover id={id} place="below-start" width={288} label="What this does" role="note">
        <p className={s.helpText}>{text}</p>
        {extra && <code className={s.helpPath}>{extra}</code>}
      </Popover>
    </>
  );
}

function Select({ id, options, initial, label }: { id: string; options: string[]; initial: string; label: string }) {
  const menu = useMenu();
  const [value, setValue] = useState(initial);
  return (
    <>
      <button type="button" className={s.select} aria-haspopup="listbox" aria-expanded={menu.id === id} aria-label={label} onClick={(e) => menu.toggle(id, e.currentTarget)}>
        {value}
        <ChevronsUpDown size={12} strokeWidth={2} />
      </button>
      <Popover id={id} place="below-end" width={168} label={label}>
        {options.map((o) => (
          <MenuItem key={o} checked={o === value} onSelect={() => setValue(o)}>
            {o}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

function Toggles({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className={s.toggles}>
      {items.map((it, i) => (
        <label key={it.label} className={s.toggle}>
          <span>{it.label}</span>
          <Switch on={on[i]!} label={it.label} onChange={(v) => setOn((a) => a.map((x, j) => (j === i ? v : x)))} />
        </label>
      ))}
    </div>
  );
}

function Checks({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className={s.checks}>
      {items.map((it, i) => (
        <button key={it.label} type="button" role="checkbox" aria-checked={on[i]} className={s.check} onClick={() => setOn((a) => a.map((x, j) => (j === i ? !x : x)))}>
          <span className={s.checkMark}>
            <CheckGlyph size={10} />
          </span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Control({ id, label, control }: { id: string; label: string; control: SettingControl }) {
  const [on, setOn] = useState(control.type === 'switch' ? control.on : false);
  const [choice, setChoice] = useState(control.type === 'segmented' ? control.value : '');
  switch (control.type) {
    case 'switch':
      return <Switch on={on} onChange={setOn} label={label} />;
    case 'segmented':
      return <Segmented options={control.options} value={choice} onChange={setChoice} label={label} />;
    case 'select':
      return <Select id={`${id}-menu`} options={control.options} initial={control.value} label={label} />;
    case 'text':
      return <input className={s.field} data-mono={control.mono || undefined} defaultValue={control.value} placeholder={control.placeholder} aria-label={label} spellCheck={false} />;
    case 'path': {
      const restated = control.badge !== undefined && control.value.endsWith(control.badge);
      return (
        <span className={s.path}>
          {!restated && <code className={s.pathValue}>{control.value}</code>}
          {control.badge && <span className={s.badge}>{control.badge}</span>}
          {control.action && (
            <button type="button" className={s.button}>
              {control.action}
            </button>
          )}
        </span>
      );
    }
    case 'button':
      return (
        <button type="button" className={s.button}>
          {control.label}
        </button>
      );
    default:
      return null;
  }
}

function Row({ setting }: { setting: Setting }) {
  const id = useId();
  const c = setting.control;
  const stacked = c.type === 'switches' || c.type === 'checks';
  // A path that the badge already restates is kept for the "?" instead of the row.
  const extra = c.type === 'path' && c.badge !== undefined && c.value.endsWith(c.badge) ? c.value : undefined;
  return (
    <div className={s.setting} data-stacked={stacked || undefined}>
      <div className={s.settingLine}>
        <span className={s.settingLabel}>
          {setting.label}
          {setting.help && <Help id={`${id}-help`} text={setting.help} extra={extra} />}
        </span>
        {!stacked && <Control id={id} label={setting.label} control={c} />}
      </div>
      {c.type === 'switches' && <Toggles items={c.items} />}
      {c.type === 'checks' && <Checks items={c.items} />}
    </div>
  );
}

export function SettingsScene({ onSection, scrollTo }: { onSection: (id: string) => void; scrollTo: { id: string; n: number } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const moving = useRef(0);

  useEffect(() => {
    if (!scrollTo) return;
    const root = ref.current;
    const el = root?.querySelector<HTMLElement>(`[data-section="${scrollTo.id}"]`);
    if (!root || !el) return;
    moving.current = Date.now() + 700;
    root.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  }, [scrollTo]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const on = () => {
      if (Date.now() < moving.current) return;
      const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'));
      const line = root.scrollTop + 80;
      let current = sections[0];
      for (const el of sections) if (el.offsetTop <= line) current = el;
      // At the end of the page the last section can never reach the top; it is still the one arrived at.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = sections[sections.length - 1];
      if (current?.dataset.section) onSection(current.dataset.section);
    };
    root.addEventListener('scroll', on, { passive: true });
    return () => root.removeEventListener('scroll', on);
  }, [onSection]);

  return (
    <div className={s.settings}>
      <div className={s.band} />
      <div ref={ref} className={s.scroll} data-edge="top">
        <div className={s.form}>
          {settingsSections.map((sec) => (
            <section key={sec.id} data-section={sec.id} className={s.section}>
              <h2 className={s.sectionTitle}>{sec.title}</h2>
              <div className={s.card}>
                {sec.settings.map((x) => (
                  <Row key={x.label} setting={x} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
