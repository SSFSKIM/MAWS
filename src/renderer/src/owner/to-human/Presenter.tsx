import { Markdown } from '../../transcript/view/markdown/Markdown';
import { hasClosedMarks, messageInk } from './message-ink';
import './presenter.css';

// The native fallback is only a decoration of the authored Markdown. Attached engine mods get first refusal;
// history and local mounts use this same drawing without inventing cards, labels, or a second working-record fold.
export function assistantPresentation(text: string) {
  return hasClosedMarks(text) ? {
    render: ({ live }: { live: boolean }) => <div className="transcript-answer"><Markdown markdown={text} live={live} decorate={messageInk} /></div>,
  } : null;
}

export function messagePresentation(text: string) {
  return <div className="transcript-answer owner-message-ink"><Markdown markdown={text} live={false} /></div>;
}
