// A session's to-human entry (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b's Renderer
// bullet; Q5), from its machine's spine: a message, or a question with its choices and, once given, its answer (one ask's
// questions together, in the order they were asked), under the session's name, its title beside a lane A alias, and its
// machine's chip (none for this Mac). While its machine isn't live it says "as of" the machine's last time; while the
// machine reads nothing at all (an older MAWS) it is greyed. Plain text, as M7a's channel draws every word. Tokens only.
import { formatDayTime } from '@shared/app/date-format';
import { addressOf } from '@shared/machine/address';
import { useMachineMark } from '../app/machine-mark';
import { CHANNEL } from './copy';
import { GIVES_WAY, MachineChipPart, Names, NAMES_ROW, partyTooltip, Time } from './parts';
import type { ToHumanEntry as Entry, ToHumanQuestion } from './project';

const PROSE = 'm-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-prose leading-[var(--lh-prose)] text-fg';

export function ToHumanEntry({ entry }: { entry: Entry }) {
  const asOf = entry.asOf === null ? NaN : Date.parse(entry.asOf);
  const address = addressOf(entry.machine, 'channel');
  const machine = useMachineMark(address, entry.machineName ?? undefined).name; // the chip's name
  const tooltip = partyTooltip(entry.name, entry.title, machine); // the name, title and machine whole, as a party's
  return (
    <article
      data-channel-entry="to-human"
      data-host={entry.host}
      data-machine={entry.machine}
      data-key={entry.key}
      data-greyed={entry.greyed ? 'true' : undefined}
      className={`flex min-w-0 flex-col gap-1 ${entry.greyed ? 'opacity-60' : ''}`}
    >
      {/* board 505: the Channel's one order (parts.tsx's GIVES_WAY): the title gives way first, then the chip, then the name. */}
      <header className={`${NAMES_ROW} text-ui-sm`}>
        <Names>
          <span data-name-part="alias" className={`${GIVES_WAY.alias} font-medium text-fg`} title={tooltip}>
            {entry.name}
          </span>
          {entry.title !== null && (
            <span data-name-part="title" className={`${GIVES_WAY.title} text-fg-muted`} title={tooltip}>
              {entry.title}
            </span>
          )}
          <MachineChipPart address={address} name={entry.machineName ?? undefined} />
        </Names>
        <span className="shrink-0 text-fg-muted">{CHANNEL.host[entry.host]}</span>
        <Time at={entry.at} />
      </header>
      {entry.host === 'question' ? (
        <div className="flex min-w-0 flex-col gap-3">
          {entry.questions.map((question) => (
            <Question key={question.key} question={question} />
          ))}
        </div>
      ) : (
        <p data-to-human-text className={PROSE}>
          {entry.text}
        </p>
      )}
      {Number.isFinite(asOf) && (
        <p data-channel-as-of={entry.asOf} className="m-0 text-ui-sm text-fg-faint">
          {CHANNEL.toHuman.asOf(formatDayTime(asOf))}
        </p>
      )}
    </article>
  );
}

function Question({ question }: { question: ToHumanQuestion }) {
  return (
    <div data-to-human-question={question.key} className="flex min-w-0 flex-col gap-1.5">
      <p data-to-human-text className={PROSE}>
        {question.text}
      </p>
      {question.choices.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {question.choices.map((choice, index) => (
            <li key={`${index}:${choice}`} className={`max-w-full break-words rounded-sm border px-2 py-0.5 text-ui-sm [overflow-wrap:anywhere] ${question.answer?.text === choice ? 'border-border-strong text-fg' : 'border-border text-fg-muted'}`}>
              {choice}
            </li>
          ))}
        </ul>
      )}
      {question.answer !== null && (
        <p data-to-human-answer className="m-0 flex min-w-0 items-baseline gap-1.5 text-ui-sm">
          <span className="shrink-0 font-medium text-fg-muted">{CHANNEL.toHuman.answer}</span>
          <span className="min-w-0 break-words whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{question.answer.text}</span>
          <Time at={question.answer.at} />
        </p>
      )}
    </div>
  );
}
