// The settings page. Geometry is Quiet's (quiet/Settings.tsx): one 620 px column of 54 px rows parted by
// hairlines, the sidebar as its index, the right margin kept empty for a row's sentence. Controls, motion and
// glass are Instrument's (instrument/Settings.tsx): the switch and the segmented thumb on one light spring,
// every list of on/off things visible as pills, and a select whose list is a glass platter.
import { Check, ChevronsUpDown } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { type BackdropHint, GlassMenu, GlassMenuContent, GlassMenuRadioGroup, GlassMenuRadioItem, GlassMenuTrigger } from '@vitreajs/vitrea-react';
import { type Setting, type SettingControl, settingsSections } from '../../content/fixtures';

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return (
    <button type="button" role="switch" aria-checked={v} aria-label={label} className="xo-switch" onClick={() => setV((x) => !x)}>
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
    <div role="radiogroup" aria-label={label} className="xo-seg" onKeyDown={onKey}>
      {box && <span className="xo-seg-thumb" style={{ transform: `translateX(${box.x}px)`, width: box.w }} />}
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

/** A list of on/off things stays on the page, each one a pill (the owner found the "5 of 6" fold too folded). */
function Pills({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className="xo-pills">
      {items.map((item, i) => (
        <button key={item.label} type="button" className="xo-pill" aria-pressed={on[i]} onClick={() => setOn((a) => a.map((x, j) => (j === i ? !x : x)))}>
          <Check />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A choice among a few: the list is a glass platter that appears beside the control, over the page. */
function Select({ options, value, label, hint }: { options: string[]; value: string; label: string; hint: BackdropHint }) {
  const [v, setV] = useState(value);
  return (
    <GlassMenu groupProps={{ hint }}>
      <GlassMenuTrigger surface="fill" className="xo-select" aria-label={`${label}: ${v}`}>
        {v}
        <ChevronsUpDown />
      </GlassMenuTrigger>
      <GlassMenuContent aria-label={label} placement="bottom-end" gap={6} radius={16} thickness={8} className="xo-platter xo-menu">
        <GlassMenuRadioGroup value={v} onValueChange={setV} aria-label={label}>
          {options.map((o) => (
            <GlassMenuRadioItem key={o} value={o} className="xo-item xo-item-radio">
              <span>{o}</span>
              <Check size={15} strokeWidth={2} />
            </GlassMenuRadioItem>
          ))}
        </GlassMenuRadioGroup>
      </GlassMenuContent>
    </GlassMenu>
  );
}

function Control({ control, label, hint }: { control: SettingControl; label: string; hint: BackdropHint }) {
  switch (control.type) {
    case 'switch':
      return <Switch on={control.on} label={label} />;
    case 'segmented':
      return <Segmented options={control.options} value={control.value} label={label} />;
    case 'select':
      return <Select options={control.options} value={control.value} label={label} hint={hint} />;
    case 'text':
      return <input className="xo-input" data-mono={control.mono} defaultValue={control.value} placeholder={control.placeholder} aria-label={label} spellCheck={false} />;
    case 'path':
      return (
        <div className="xo-path">
          <code>{control.value}</code>
          {control.badge && control.badge !== control.value.split('/').pop() && <span className="xo-badge">{control.badge}</span>}
          {control.action && (
            <button type="button" className="xo-btn">
              {control.action}
            </button>
          )}
        </div>
      );
    case 'button':
      return (
        <button type="button" className="xo-btn">
          {control.label}
        </button>
      );
    case 'checks':
    case 'switches':
      return <Pills items={control.items} />;
  }
}

function Row({ setting, hint }: { setting: Setting; hint: BackdropHint }) {
  const stack = setting.control.type === 'checks' || setting.control.type === 'switches';
  // A button that says what it does needs no label beside it (Instrument's).
  const bare = setting.control.type === 'button';
  return (
    <div className="xo-set" data-stack={stack}>
      {!bare && <div className="xo-set-label">{setting.label}</div>}
      <Control control={setting.control} label={setting.label} hint={hint} />
      {/* The sentence the app prints under every setting today waits in the margin for the pointer or for focus. */}
      {setting.help && <p className="xo-note">{setting.help}</p>}
    </div>
  );
}

export function SettingsPage({ hint }: { hint: BackdropHint }) {
  return (
    <div className="xo-page">
      <div className="xo-page-col">
        {settingsSections.map((sec) => (
          <section key={sec.id} className="xo-section" id={`x-open-${sec.title.toLowerCase()}`} data-title={sec.title} aria-label={sec.title}>
            <h2 className="xo-section-title">{sec.title}</h2>
            {sec.settings.map((setting) => (
              <Row key={setting.label} setting={setting} hint={hint} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Which section the page is on, for the index in the sidebar (Quiet's scroll spy). */
export function sectionAt(scroller: HTMLElement): string {
  let at = settingsSections[0]!.title;
  for (const sec of scroller.querySelectorAll<HTMLElement>('section[data-title]')) {
    if (sec.offsetTop - scroller.scrollTop <= 140) at = sec.dataset.title!;
  }
  return at;
}
