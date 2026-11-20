// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, M2's decisions): `userTextOf` as it stood
// at the landing's pin (`bdbfe863e`, src/renderer/src/transcript/model/user-text.ts), copied, never imported: the oracle
// of the differential (acceptance 8) and of "read in place, it is the pin's row" (acceptance 7), for text content (no
// image or document). The functions it calls are this build's and unchanged by the landing.
import { readAnchoredMessage, type MessageComment } from '../../src/shared/anchor/message';
import type { ContentBlock } from '../../src/shared/graph/events';
import { linkedReadOf } from '../../src/shared/maws/linked-read';
import { slashCommandLine } from '../../src/shared/wire/local-command';
import type { Attachment } from '../../src/renderer/src/transcript/model/rows';
import { splitPastedSegments } from '../../src/renderer/src/transcript/model/user-text';

export function pinUserTextOf(content: string | ContentBlock[]) {
  const texts: string[] = [];
  const attachments: Attachment[] = [];
  if (typeof content === 'string') texts.push(content);
  else {
    content.forEach((block) => {
      const linked = block.type === 'text' && typeof block.text === 'string' ? linkedReadOf(block.text) : null;
      if (linked) attachments.push({ kind: 'file', name: `${linked.title}, read at revision ${linked.revision}`, bytes: null, dataUrl: null, mediaType: `sent with the message: the ${linked.kind} as artifact_read returned it`, text: null });
      else if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    });
  }
  const joined = texts.join('\n\n');
  const read = joined.includes('<maws_anchor') ? readAnchoredMessage(joined) : null;
  const several: MessageComment[] | null = read !== null && read.comments.length > 1 ? read.comments : null;
  const anchored = read !== null && several === null ? read.comments[0]! : null;
  const body = several?.map((comment) => comment.text).join('\n\n') ?? anchored?.text ?? joined;
  const split = several ? { text: body, attachments: [], placeholders: [] } : splitPastedSegments(slashCommandLine(body) ?? body);
  const text = split.text;
  return { text, attachments: [...split.attachments, ...attachments], placeholders: split.placeholders, lines: text.length === 0 ? 0 : text.split('\n').length, anchor: anchored?.anchor ?? null, frame: anchored ? { destination: read!.destination, screenshot: anchored.screenshot } : null, comments: several && several.map(({ anchor, text: words }) => ({ anchor, text: words })), commentsTo: several && read!.destination === 'thread' ? ('thread' as const) : null };
}
