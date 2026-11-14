import { Check, ChevronsUpDown } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  type BackdropHint,
  GlassMenu,
  GlassMenuContent,
  GlassMenuRadioGroup,
  GlassMenuRadioItem,
  GlassMenuTrigger,
} from '@vitreajs/vitrea-react';
import { type Setting, type SettingControl, settingsNav, settingsSections } from '../../content/fixtures';
import type { Scheme } from '../../lab/types';
import s from './instrument.module.css';
import { cx } from './parts';

const sectionId = (title: string) => `xi-settings-${title.toLowerCase()}`;

/** The sidebar while settings are open: the sections, as print. The current one follows the page as it scrolls. */
export function SettingsIndex({ scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
  const [current, setCurrent] = useState(settingsSections[0]!.title);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => {
      let now = settingsSections[0]!.title;
      for (const sec of settingsSections) {
        const node = el.querySelector<HTMLElement>(`#${sectionId(sec.title)}`);
        if (node && node.offsetTop - el.scrollTop < 180) now = sec.title;
      }
      setCurrent(now);
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    return () => el.removeEventListener('scroll', read);
  }, [scroller]);
  return (
    <div className={s.nav}>
      {settingsNav.map((name) => (
        <button
          key={name}
          type="button"
          className={s.row}
          aria-current={name === current ? 'true' : undefined}
          onClick={() => scroller.current?.querySelector(`#${sectionId(name)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <span className={s.rowLabel}>{name}</span>
        </button>
      ))}
    </div>
  );
}

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return (
    <button type="button" role="switch" aria-checked={v} aria-label={label} className={s.switch} onClick={() => setV((x) => !x)}>
      <i />
    </button>
  );
}

function Segmented({ options, value, label }: { options: string[]; value: string; label: string }) {
  const [v, setV] = useState(value);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current[options.indexOf(v)];
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, [v, options]);
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (options.indexOf(v) + d + options.length) % options.length;
    setV(options[next]!);
    buttons.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={s.seg} onKeyDown={onKey}>
      {box && <span className={s.segThumb} style={{ transform: `translateX(${box.x}px)`, width: box.w }} />}
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === v}
          tabIndex={o === v ? 0 : -1}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          onClick={() => setV(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Pills({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className={s.pills}>
      {items.map((item, i) => (
        <button key={item.label} type="button" className={s.pill} aria-pressed={on[i]} onClick={() => setOn((a) => a.map((x, j) => (j === i ? !x : x)))}>
          <Check />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A choice among a few: the list is a glass platter that appears beside the control, over the page. */
function Select({ options, value, label, scheme, hint }: { options: string[]; value: string; label: string; scheme: Scheme; hint: BackdropHint }) {
  const [v, setV] = useState(value);
  return (
    <GlassMenu groupProps={{ hint }}>
      <GlassMenuTrigger surface="fill" className={s.select} aria-label={`${label}: ${v}`}>
        {v}
        <ChevronsUpDown />
      </GlassMenuTrigger>
      <GlassMenuContent aria-label={label} placement="bottom-end" gap={6} radius={20} thickness={8} className={cx(s.platter, s.menu, s[scheme])}>
        <GlassMenuRadioGroup value={v} onValueChange={setV} aria-label={label}>
          {options.map((o) => (
            <GlassMenuRadioItem key={o} value={o} className={s.menuItem}>
              {o}
            </GlassMenuRadioItem>
          ))}
        </GlassMenuRadioGroup>
      </GlassMenuContent>
    </GlassMenu>
  );
}

function Control({ control, label, scheme, hint }: { control: SettingControl; label: string; scheme: Scheme; hint: BackdropHint }) {
  switch (control.type) {
    case 'switch':
      return <Switch on={control.on} label={label} />;
    case 'segmented':
      return <Segmented options={control.options} value={control.value} label={label} />;
    case 'select':
      return <Select options={control.options} value={control.value} label={label} scheme={scheme} hint={hint} />;
    case 'text':
      return <input className={s.input} data-mono={control.mono} defaultValue={control.value} placeholder={control.placeholder} aria-label={label} spellCheck={false} />;
    case 'path':
      return (
        <div className={s.path}>
          <code>{control.value}</code>
          {control.badge && control.badge !== control.value.split('/').pop() && <span className={s.badge}>{control.badge}</span>}
          {control.action && (
            <button type="button" className={s.btn}>
              {control.action}
            </button>
          )}
        </div>
      );
    case 'button':
      return (
        <button type="button" className={s.btn}>
          {control.label}
        </button>
      );
    case 'checks':
    case 'switches':
      return <Pills items={control.items} />;
  }
}

function Row({ setting, scheme, hint }: { setting: Setting; scheme: Scheme; hint: BackdropHint }) {
  const stack = setting.control.type === 'checks' || setting.control.type === 'switches';
  // A button that says what it does needs no label beside it.
  const bare = setting.control.type === 'button';
  return (
    <div className={s.setting} data-stack={stack}>
      {!bare && <div className={s.settingLabel}>{setting.label}</div>}
      <Control control={setting.control} label={setting.label} scheme={scheme} hint={hint} />
      {setting.help && <p className={s.help}>{setting.help}</p>}
    </div>
  );
}

export function SettingsPage({ scheme, hint }: { scheme: Scheme; hint: BackdropHint }) {
  return (
    <div className={s.page}>
      {settingsSections.map((sec) => (
        <section className={s.section} id={sectionId(sec.title)} key={sec.id} aria-label={sec.title}>
          <h2>{sec.title}</h2>
          {sec.settings.map((setting) => (
            <Row key={setting.label} setting={setting} scheme={scheme} hint={hint} />
          ))}
        </section>
      ))}
    </div>
  );
}
