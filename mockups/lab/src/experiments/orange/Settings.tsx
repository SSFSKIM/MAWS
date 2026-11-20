import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { settingsSections, type Setting } from '../../content/fixtures';
import { Pop } from './overlay';
import s from './orange.module.css';

// Quiet's page (one 620 px column of rows parted by hairlines, the sidebar as its index, the help sentence waiting
// in the right margin for the pointer or the focus), with Instrument's controls: lists shown as pills instead of
// folded behind a count, a knob and a thumb that travel on a spring, a menu that is a platter of glass.

function Switch({ on, label }: { on: boolean; label: string }) {
  const [v, setV] = useState(on);
  return (
    <button type="button" role="switch" aria-checked={v} aria-label={label} className={s.switch} onClick={() => setV((x) => !x)}>
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
    <div role="radiogroup" aria-label={label} className={s.seg} onKeyDown={onKey}>
      {box && <span className={s.segThumb} style={{ transform: `translateX(${box.x}px)`, width: box.w }} />}
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === v}
          tabIndex={o === v ? 0 : -1}
          className={s.segOpt}
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
          <Check strokeWidth={2.5} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Select({ options, value, label }: { options: string[]; value: string; label: string }) {
  const [v, setV] = useState(value);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={setEl} type="button" className={s.pick} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${v}`} onClick={() => setOpen((x) => !x)}>
        {v}
        <ChevronsUpDown size={13} strokeWidth={1.75} />
      </button>
      <Pop open={open} anchor={el} place="below-end" onClose={close}>
        {options.map((o) => (
          <button
            key={o}
            className={s.item}
            role="option"
            aria-selected={o === v}
            onClick={() => {
              setV(o);
              close();
            }}
          >
            <span>{o}</span>
            {o === v && <Check size={15} strokeWidth={2} />}
          </button>
        ))}
      </Pop>
    </>
  );
}

function Control({ setting }: { setting: Setting }) {
  const c = setting.control;
  switch (c.type) {
    case 'switch':
      return <Switch on={c.on} label={setting.label} />;
    case 'segmented':
      return <Segmented options={c.options} value={c.value} label={setting.label} />;
    case 'select':
      return <Select options={c.options} value={c.value} label={setting.label} />;
    case 'text':
      return <input className={s.input} data-mono={c.mono ? '' : undefined} defaultValue={c.value} placeholder={c.placeholder} aria-label={setting.label} spellCheck={false} />;
    case 'button':
      return (
        <button type="button" className={s.btn}>
          {c.label}
        </button>
      );
    case 'path': {
      // A long path is not read; its version is. The path stays one hover away (Quiet).
      const long = c.value.length > 16 && c.badge !== undefined;
      return (
        <>
          {long ? (
            <span className={s.valueMono} data-tip={c.value} data-tip-at="end" style={{ position: 'relative' }} tabIndex={0}>
              {c.badge}
            </span>
          ) : (
            <>
              <span className={s.valueMono}>{c.value}</span>
              {c.badge && <span className={s.aside2}>{c.badge}</span>}
            </>
          )}
          {c.action && (
            <button type="button" className={s.btn}>
              {c.action}
            </button>
          )}
        </>
      );
    }
    case 'checks':
    case 'switches':
      return <Pills items={c.items} />;
  }
}

function Row({ setting }: { setting: Setting }) {
  const stack = setting.control.type === 'checks' || setting.control.type === 'switches';
  // A button that says what it does needs no label beside it (Instrument).
  const bare = setting.control.type === 'button';
  return (
    <div className={s.set}>
      {stack ? (
        <div className={s.setStack}>
          <div className={s.setLabel}>{setting.label}</div>
          <Control setting={setting} />
        </div>
      ) : (
        <div className={s.setRow}>
          {!bare && (
            <div className={s.setText}>
              <div className={s.setLabel}>{setting.label}</div>
            </div>
          )}
          <div className={s.setCtl}>
            <Control setting={setting} />
          </div>
        </div>
      )}
      {setting.help && <p className={s.note}>{setting.help}</p>}
    </div>
  );
}

export function Settings({ onSection }: { onSection: (title: string) => void }) {
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
    <div className={s.scene}>
      <section className={`${s.read} ${s.glass}`} data-o-surface="Settings" aria-label="Settings">
        <div className={s.page} ref={page} onScroll={spy} data-o-scroll="">
          <div className={s.pageIn}>
            <div className={s.pageCol}>
              {settingsSections.map((sec) => (
                <section key={sec.id} className={s.section} id={`x-orange-${sec.title.toLowerCase()}`} data-title={sec.title}>
                  <h2 className={s.sectionTitle}>{sec.title}</h2>
                  {sec.settings.map((setting) => (
                    <Row key={setting.label} setting={setting} />
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
