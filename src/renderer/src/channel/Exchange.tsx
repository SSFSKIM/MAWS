// Agent-to-agent traffic folded to one row per exchange (P5 O8 M7a, Q5): "maws-45 and ci-opt · 3", each name with its
// machine chip, the count named by its meaning ("3 messages", its tooltip too; the word cut, P448); a session's run of
// messages to the whole project reads "maws-45 · 3", the default audience unsaid (P447). A click opens the exchange's
// messages in place, and closes them again.
import { useId, useState } from 'react';
import { Tip } from '../ui/tip';
import { CHANNEL } from './copy';
import { faintOf, LabelLine, Names, NAMES_ROW, Party, Recipients, Time } from './parts';
import type { ExchangeEntry, SayEntry } from './project';

export function ExchangeRow({ entry }: { entry: ExchangeEntry }) {
  const [open, setOpen] = useState(false);
  const body = useId();
  const [from, other] = entry.between;
  const count = CHANNEL.messages(entry.count);
  return (
    // The button's hover pill reaches 8px past the text on each side (`-mx-2 px-2`); the section's own padding holds it
    // (`-mx-2 px-2` here too), so nothing reaches past the section's box.
    <section data-channel-entry="exchange" data-offset={entry.offsets[0]} data-channel-label={entry.label} data-count={entry.count} className={`-mx-2 flex min-w-0 flex-col gap-1 px-2 ${faintOf(entry)}`}>
      <Tip content={count}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          aria-describedby={undefined}
          onClick={() => setOpen((was) => !was)}
          className={`-mx-2 ${NAMES_ROW} rounded-sm px-2 py-1 text-left text-ui text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2`}
        >
          <span aria-hidden className={`shrink-0 text-ui-sm text-fg-faint transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}>
            ›
          </span>
          <Names>
            <Party party={from} title={false} />
            {other !== 'everyone' && (
              <>
                <span className="shrink-0">{CHANNEL.and}</span>
                <Party party={other} title={false} />
              </>
            )}
            {/* the count follows the names, in their group, the group's room left after it */}
            <span aria-hidden className="shrink-0 text-fg-faint">
              ·
            </span>
            <span role="img" aria-label={count} className="shrink-0 tabular-nums">
              {entry.count}
            </span>
          </Names>
          <Time at={entry.last} />
        </button>
      </Tip>
      <LabelLine entry={entry} />
      {open && (
        <ol id={body} data-channel-exchange-messages className="m-0 flex list-none flex-col gap-2 border-l border-border py-1 pl-3">
          {entry.says.map((say) => (
            <SayLine key={say.key} say={say} />
          ))}
        </ol>
      )}
    </section>
  );
}

function SayLine({ say }: { say: SayEntry }) {
  return (
    <li data-offset={say.offset} className="flex min-w-0 flex-col gap-0.5">
      <div className={`${NAMES_ROW} text-ui-sm`}>
        <Names>
          <Party party={say.from} title={false} />
          <Recipients to={say.to} />
        </Names>
        <Time at={say.at} />
      </div>
      <p className="m-0 text-ui break-words whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{say.text}</p>
    </li>
  );
}
