// The settings page. Where things are is Quiet's (`../quiet/Settings.tsx`): the pane becomes the index, one column
// of rows, a label on the left and its control on the right, hairlines between, the sentence in the right margin.
// What the controls are and how they move is Instrument's (`../instrument/Settings.tsx`): lists stay on the page
// as pills, the thumb and the knob travel on a spring, and a choice opens as a glass platter over the rows.
import { Check, ChevronsUpDown } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';
import { type BackdropHint, GlassMenu, GlassMenuContent, GlassMenuRadioGroup, GlassMenuRadioItem, GlassMenuTrigger } from '@vitreajs/vitrea-react';
import { type Setting, type SettingControl, settingsSections } from '../../content/fixtures';

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return (
    <button type="button" role="switch" aria-checked={v} aria-label={label} className="xs-switch" onClick={() => setV((x) => !x)}>
      <i />
    </button>
  );
}

/** The thumb is one object that travels between options; it is never redrawn at the new place. */
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
    <div role="radiogroup" aria-label={label} className="xs-seg" onKeyDown={onKey}>
      {box && <span className="xs-seg-thumb" style={{ transform: `translateX(${box.x}px)`, width: box.w }} />}
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
    <div className="xs-pills">
      {items.map((item, i) => (
        <button key={item.label} type="button" className="xs-pill" aria-pressed={on[i]} onClick={() => setOn((a) => a.map((x, j) => (j === i ? !x : x)))}>
          <Check />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A choice among a few: the list is a glass platter that appears beside the control, over the rows of the page. */
function Select({ options, value, label, hint }: { options: string[]; value: string; label: string; hint: BackdropHint }) {
  const [v, setV] = useState(value);
  return (
    <GlassMenu groupProps={{ hint }}>
      <GlassMenuTrigger surface="fill" className="xs-select" aria-label={`${label}: ${v}`}>
        {v}
        <ChevronsUpDown />
      </GlassMenuTrigger>
      <GlassMenuContent aria-label={label} placement="bottom-end" gap={6} radius={20} thickness={8} className="xs-platter xs-menu">
        <GlassMenuRadioGroup value={v} onValueChange={setV} aria-label={label}>
          {options.map((o) => (
            <GlassMenuRadioItem key={o} value={o} className="xs-menu-item">
              {o}
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
      return <input className="xs-input" data-mono={control.mono} defaultValue={control.value} placeholder={control.placeholder} aria-label={label} spellCheck={false} />;
    case 'path': {
      // A long path is not read; its version is. The path stays one hover away (Quiet's cut).
      const long = control.value.length > 16 && control.badge !== undefined;
      return (
        <div className="xs-path">
          {long ? (
            <code data-tip={control.value} data-tip-at="end" tabIndex={0}>
              {control.badge}
            </code>
          ) : (
            <>
              <code>{control.value}</code>
              {control.badge && <span className="xs-badge">{control.badge}</span>}
            </>
          )}
          {control.action && (
            <button type="button" className="xs-btn">
              {control.action}
            </button>
          )}
        </div>
      );
    }
    case 'button':
      return (
        <button type="button" className="xs-btn">
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
  return (
    <div className="xs-set" data-stack={stack}>
      <div className="xs-set-label">{setting.label}</div>
      <div className="xs-set-ctl">
        <Control control={setting.control} label={setting.label} hint={hint} />
      </div>
      {setting.help && <p className="xs-note">{setting.help}</p>}
    </div>
  );
}

export function SettingsPage({ onSection, hint }: { onSection: (title: string) => void; hint: BackdropHint }) {
  const page = useRef<HTMLDivElement>(null);
  const spy = () => {
    const el = page.current;
    if (!el) return;
    let at = settingsSections[0]!.title;
    for (const sec of el.querySelectorAll<HTMLElement>('section[data-title]')) {
      if (sec.offsetTop - el.scrollTop <= 96) at = sec.dataset.title!;
    }
    onSection(at);
  };
  return (
    <div className="xs-page" ref={page} onScroll={spy}>
      <div className="xs-page-in">
        <div className="xs-page-col">
          {settingsSections.map((sec) => (
            <section key={sec.id} className="xs-section" id={`x-sheet-${sec.title.toLowerCase()}`} data-title={sec.title}>
              <h2 className="xs-section-title">{sec.title}</h2>
              {sec.settings.map((setting) => (
                <Row key={setting.label} setting={setting} hint={hint} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
