import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { settingsSections, type Setting, type SettingControl } from '../../content/fixtures';
import { Fold, Pop } from './overlay';
import s from './quiet.module.css';

/** The first sentence of a help text: what is printed when exactly one sentence is allowed. */
const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={s.switch} role="switch" aria-checked={on} data-on={on} aria-label={label} onClick={() => onChange(!on)} />;
}

/** The thumb is one object that slides between options; it is never redrawn at the new place. */
function Segmented({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value]);
  return (
    <div className={s.seg} role="radiogroup" aria-label={label} ref={wrap}>
      {box && <span className={s.segThumb} style={{ width: box.w, transform: `translateX(${box.x}px)` }} />}
      {options.map((o) => (
        <button key={o} className={s.segOpt} role="radio" aria-checked={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Select({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={setEl} className={s.pick} aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        {value}
        <ChevronsUpDown size={13} strokeWidth={1.75} />
      </button>
      <Pop open={open} anchor={el} place="below-end" onClose={close}>
        {options.map((o) => (
          <button
            key={o}
            className={s.item}
            role="option"
            aria-selected={o === value}
            onClick={() => {
              onChange(o);
              close();
            }}
          >
            <span>{o}</span>
            {o === value && <Check size={15} strokeWidth={2} />}
          </button>
        ))}
      </Pop>
    </>
  );
}

type Many = Extract<SettingControl, { type: 'checks' | 'switches' }>;

function Row({ setting, help }: { setting: Setting; help: string }) {
  const c = setting.control;
  const [on, setOn] = useState(c.type === 'switch' ? c.on : false);
  const [value, setValue] = useState(c.type === 'segmented' || c.type === 'select' || c.type === 'text' ? c.value : '');
  const [items, setItems] = useState(c.type === 'checks' || c.type === 'switches' ? c.items.map((i) => i.on) : []);
  const [list, setList] = useState(false);
  const [told, setTold] = useState(false);
  const many = c.type === 'checks' || c.type === 'switches' ? (c as Many) : null;

  let control = null;
  if (c.type === 'switch') control = <Switch on={on} onChange={setOn} label={setting.label} />;
  else if (c.type === 'segmented') control = <Segmented options={c.options} value={value} onChange={setValue} label={setting.label} />;
  else if (c.type === 'select') control = <Select options={c.options} value={value} onChange={setValue} label={setting.label} />;
  else if (c.type === 'text')
    control = (
      <input
        className={s.input}
        data-mono={c.mono ? '' : undefined}
        value={value}
        placeholder={c.placeholder}
        aria-label={setting.label}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  else if (c.type === 'button') control = <button className={s.btn}>{c.label}</button>;
  else if (c.type === 'path') {
    // A long path is not read; its version is. The path stays one hover away.
    const long = c.value.length > 16 && c.badge !== undefined;
    control = (
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
        {c.action && <button className={s.btn}>{c.action}</button>}
      </>
    );
  } else if (many) {
    control = (
      <button className={s.more} aria-expanded={list} onClick={() => setList((v) => !v)}>
        <span className={s.num}>
          {items.filter(Boolean).length} of {items.length}
        </span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
    );
  }

  const text = setting.help;
  return (
    <div className={s.set}>
      <div className={s.setRow}>
        <div className={s.setText}>
          {help === 'expander' && text ? (
            <button className={s.setLabel} aria-expanded={told} onClick={() => setTold((v) => !v)}>
              {setting.label}
              <ChevronRight size={13} strokeWidth={2} />
            </button>
          ) : (
            <div className={s.setLabel}>{setting.label}</div>
          )}
          {help === 'sentence' && text && <p className={s.help}>{firstSentence(text)}</p>}
        </div>
        <div className={s.setCtl}>{control}</div>
      </div>
      {help === 'hover' && text && <p className={s.note}>{text}</p>}
      {help === 'expander' && text && (
        <Fold open={told} className={s.helpFold}>
          <p className={s.help}>{text}</p>
        </Fold>
      )}
      {many && (
        <Fold open={list}>
          <div className={s.many}>
            {many.items.map((item, i) => (
              <button
                key={item.label}
                className={s.manyItem}
                role={many.type === 'switches' ? 'switch' : 'checkbox'}
                aria-checked={items[i]}
                onClick={() => setItems((prev) => prev.map((v, j) => (j === i ? !v : v)))}
              >
                {many.type === 'checks' && (
                  <i className={s.check}>
                    <Check size={12} strokeWidth={3} />
                  </i>
                )}
                <span>{item.label}</span>
                {many.type === 'switches' && <i className={s.switch} data-size="s" data-on={items[i]} />}
              </button>
            ))}
          </div>
        </Fold>
      )}
    </div>
  );
}

export function Settings({ help, onSection }: { help: string; onSection: (title: string) => void }) {
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
      <div className={s.page} ref={page} onScroll={spy}>
        <div className={s.pageIn}>
          <div className={s.pageCol}>
            {settingsSections.map((sec) => (
              <section key={sec.id} className={s.section} id={`x-quiet-${sec.title.toLowerCase()}`} data-title={sec.title}>
                <h2 className={s.sectionTitle}>{sec.title}</h2>
                {sec.settings.map((setting) => (
                  <Row key={setting.label} setting={setting} help={help} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
