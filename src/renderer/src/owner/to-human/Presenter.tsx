import { useDisclosure } from '../../transcript/view/context';
import { Chevron } from '../../transcript/view/rows/parts';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { parse, type Kind, type Part } from './parser';
import './presenter.css';

const labels: Record<Kind, string> = { 'to-human': 'to human', essential: 'essential', 'need-input': 'need input', insight: 'insight' };
type Drawing = { showRecord: boolean; live: boolean; recordKey: string; hasWorkFold?: boolean };

// The only registration API: callers know whether a presentation exists, not the owner's vocabulary.
export function assistantPresentation(text: string) {
  const parts = parse(text);
  return parts.some((part) => part.kind !== 'plain') ? {
    render: (drawing: Drawing) => <Presenter parts={parts} {...drawing} />,
  } : null;
}

function Presenter({ parts, showRecord, live, recordKey, hasWorkFold = true }: Drawing & { parts: Part[] }) {
  const [recordOpen, toggleRecord] = useDisclosure(`owner-report:${recordKey}`);
  // A text-only answer has no turn work divider. Keep its record reachable without changing transcript derivation.
  const ownFold = !hasWorkFold && parts.some((part) => part.kind === 'plain' && part.text.trim());
  showRecord = ownFold ? recordOpen : showRecord;
  return <div className="owner-report" data-owner-report="">
    {parts.map((part, index) => {
      if (part.kind === 'plain') return showRecord && part.text.trim() ? <div key={index} className="transcript-commentary"><Markdown markdown={part.text} live={live} /></div> : null;
      const Tag = part.kind === 'insight' ? 'aside' : 'section';
      return <Tag key={index} data-owner-span={part.kind} className={`owner-report-span transcript-answer${part.kind === 'essential' ? ' font-semibold' : ''}`} aria-label={labels[part.kind]}>
        <div className="owner-report-label">{labels[part.kind]}</div>
        <div className="owner-report-body">
          <Markdown markdown={part.text} live={live} />
          {part.choices && <ol className="owner-report-choices">{part.choices.map((choice, n) => <li key={n}>
            <Markdown markdown={choice.text} live={false} />
            {choice.recommended && <span className="owner-report-recommended">Recommended</span>}
          </li>)}</ol>}
          {part.kind === 'need-input' && <p className="owner-report-resume">Resume this session to answer.</p>}
        </div>
      </Tag>;
    })}
    {ownFold && <button type="button" className="transcript-disclosure" aria-expanded={recordOpen} onClick={toggleRecord}><Chevron />Working record</button>}
  </div>;
}
