// A message to the person where MAWS draws it (UX wave U2b; the execution document, A12, Interfaces §D and M2): the
// to-human mod's drawing, reproduced (`spanRows`, `to-human/hooks/mods/to-human.tsx` 1411, read at 0.8.2). One wrapper,
// `owner-message-ink`, holds the label and then the body: the label is the bullet's two-column slot and `message`, bold
// in the accent colour (the engine theme's `claude`, as `engine-surface/style.ts` maps it); the body, indented by the
// slot's two columns, is the message's Markdown in the normal text colour. A `<message>` span (drawn inside its text's
// one Markdown tree, `owner/to-human/message-ink.ts`) and a message-tool call (`MessageView`) are the same elements.
//
// Ruling 3 of 2026-11-15, as its items (i) and (vi) place it: a later message's label keeps the bullet's slot empty,
// so `message` stands in the column of `● message`'s word, over the body (`MessageLabel`, `messageLabelNode`, and
// `.owner-message-bullet` in `view.css`); the body keeps the transcript's own line spacing (no rule of `view.css`
// spaces its lines or blocks; the prose's own do).
import { createContext, useContext } from 'react';
import type { Element } from 'hast';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { MESSAGE } from './copy';
import './view.css';

// The label's words: the bullet before the first message of a text block and before a message-tool call (the engine
// marks every text row of its conversation list as the first of its reply, ruling 4), none before a later message of
// the same block; ` …` while the message streams.
const wordOf = (open: boolean) => `${MESSAGE.label}${open ? MESSAGE.streaming : ''}`;

export function MessageLabel({ first, open = false }: { first: boolean; open?: boolean }) {
  return (
    <div className="owner-message-label">
      <span className="owner-message-bullet">{first ? MESSAGE.bullet : ''}</span>
      {wordOf(open)}
    </div>
  );
}

/** The same label as a node of a decorated Markdown tree (`message-ink.ts`), element for element. */
export function messageLabelNode(first: boolean, open: boolean): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: { className: ['owner-message-label'] },
    children: [
      { type: 'element', tagName: 'span', properties: { className: ['owner-message-bullet'] }, children: first ? [{ type: 'text', value: MESSAGE.bullet }] : [] },
      { type: 'text', value: wordOf(open) },
    ],
  };
}

/** A message-tool call's message: one message, its label always with the bullet (`spanRows`' caller at `ToolUse`, 1809). */
export function MessageView({ text }: { text: string }) {
  return (
    <div className="transcript-answer">
      <div className="owner-message-ink">
        <MessageLabel first />
        <Markdown markdown={text} live={false} />
      </div>
    </div>
  );
}

// A closed stretch's head (the mirror's `reportOnly`): its text is drawn with only its messages, as the mod draws a
// folded mixed row (`spanRows` over the parsed spans, its own words left to the record). The row's drawing reads it
// here, wherever in the row's tree the presentation is mounted.
const ReportOnlyContext = createContext(false);
export const ReportOnly = ReportOnlyContext.Provider;
export const useReportOnly = (): boolean => useContext(ReportOnlyContext);
