// Settings: Quiet's page (one 620 px column of 54 px rows parted by hairlines, the right margin kept for a row's
// sentence) with Instrument's controls and motion (lists stay visible as pills, a switch and a segmented thumb on a
// light spring, a select whose list is a glass platter).
import { type KeyboardEvent, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { GlassMenu, GlassMenuContent, GlassMenuRadioGroup, GlassMenuRadioItem, GlassMenuTrigger, useGlassScrollEdge } from '@vitreajs/vitrea-react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { type Setting, type SettingControl, settingsSections } from '../../content/fixtures';
import type { Scheme } from '../../lab/types';
import { PLANE, THICKNESS } from './glass';

const sectionId = (title: string) => `xl-settings-${title.toLowerCase()}`;

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return (
    <button type="button" role="switch" aria-checked={v} aria-label={label} className="xl-switch" onClick={() => setV((x) => !x)}>
      <i />
    </button>
  );
}

/** The thumb is one object that slides between options; it is never redrawn at the new place. */
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
    <div role="radiogroup" aria-label={label} className="xl-seg" onKeyDown={onKey}>
      {box && <span className="xl-seg-thumb" style={{ transform: `translateX(${box.x}px)`, width: box.w }} />}
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

/** A list of on/off things stays on the page, as pills; nothing is folded behind a count. */
function Pills({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className="xl-pills">
      {items.map((item, i) => (
        <button key={item.label} type="button" className="xl-pill" aria-pressed={on[i]} onClick={() => setOn((a) => a.map((x, j) => (j === i ? !x : x)))}>
          <Check />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A choice among a few: the list is a glass platter that materialises beside the control, over the field. */
function Select({ options, value, label, scheme }: { options: string[]; value: string; label: string; scheme: Scheme }) {
  const [v, setV] = useState(value);
  return (
    <GlassMenu groupProps={{ backdrop: PLANE }}>
      <GlassMenuTrigger surface="fill" className="xl-select" aria-label={`${label}: ${v}`}>
        {v}
        <ChevronsUpDown />
      </GlassMenuTrigger>
      <GlassMenuContent aria-label={label} placement="bottom-end" gap={6} radius={20} thickness={THICKNESS} className="xl-platter xl-menu" data-scheme={scheme}>
        <GlassMenuRadioGroup value={v} onValueChange={setV} aria-label={label}>
          {options.map((o) => (
            <GlassMenuRadioItem key={o} value={o} className="xl-menu-item">
              {o}
            </GlassMenuRadioItem>
          ))}
        </GlassMenuRadioGroup>
      </GlassMenuContent>
    </GlassMenu>
  );
}

function Control({ control, label, scheme }: { control: SettingControl; label: string; scheme: Scheme }) {
  switch (control.type) {
    case 'switch':
      return <Switch on={control.on} label={label} />;
    case 'segmented':
      return <Segmented options={control.options} value={control.value} label={label} />;
    case 'select':
      return <Select options={control.options} value={control.value} label={label} scheme={scheme} />;
    case 'text':
      return <input className="xl-input" data-mono={control.mono} defaultValue={control.value} placeholder={control.placeholder} aria-label={label} spellCheck={false} />;
    case 'path': {
      // A long path is not read; its version is. The path stays one hover away (Quiet).
      const long = control.value.length > 16 && control.badge !== undefined;
      return (
        <div className="xl-path">
          {long ? (
            <code data-tip={control.value} data-tip-at="end" tabIndex={0}>
              {control.badge}
            </code>
          ) : (
            <>
              <code>{control.value}</code>
              {control.badge && <span className="xl-badge">{control.badge}</span>}
            </>
          )}
          {control.action && (
            <button type="button" className="xl-btn">
              {control.action}
            </button>
          )}
        </div>
      );
    }
    case 'button':
      return (
        <button type="button" className="xl-btn">
          {control.label}
        </button>
      );
    case 'checks':
    case 'switches':
      return <Pills items={control.items} />;
  }
}

function Row({ setting, scheme }: { setting: Setting; scheme: Scheme }) {
  const stack = setting.control.type === 'checks' || setting.control.type === 'switches';
  return (
    <div className="xl-set" data-stack={stack}>
      <div className="xl-set-label">{setting.label}</div>
      <div className="xl-set-ctl">
        <Control control={setting.control} label={setting.label} scheme={scheme} />
      </div>
      {setting.help && <p className="xl-note">{setting.help}</p>}
    </div>
  );
}

export function Settings({ scheme, onSection, scroller }: { scheme: Scheme; onSection: (title: string) => void; scroller: RefObject<HTMLDivElement | null> }) {
  useGlassScrollEdge(scroller, { edges: ['top'], style: 'soft', inset: 10 });
  const spy = () => {
    const el = scroller.current;
    if (!el) return;
    let at = settingsSections[0]!.title;
    for (const sec of el.querySelectorAll<HTMLElement>('section[data-title]')) {
      if (sec.offsetTop - el.scrollTop <= 140) at = sec.dataset.title!;
    }
    onSection(at);
  };
  return (
    <div className="xl-page" ref={scroller} onScroll={spy} tabIndex={-1}>
      <div className="xl-page-in">
        <div className="xl-page-col">
          {settingsSections.map((sec) => (
            <section key={sec.id} className="xl-section" id={sectionId(sec.title)} data-title={sec.title} aria-label={sec.title}>
              <h2 className="xl-section-title">{sec.title}</h2>
              {sec.settings.map((setting) => (
                <Row key={setting.label} setting={setting} scheme={scheme} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
