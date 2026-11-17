// Ticket 733a (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, M2's decisions): the writers of the three
// content forms and the paste's frame as they stood at the landing's pin (`bdbfe863e`: `src/shared/anchor/message.ts`,
// `src/shared/engine/host-prompts.ts`, `src/shared/composer/pasted-framing.ts`), copied, never imported, so that "read in
// place, it is the pin's text" is held against the pin's own bytes and a row "written at the pin" is a fixture of the
// pin's writer. The forms' fixed words and the anchor's tag are the constants this build still exports (no constant of a
// form moves in this landing).
import { anchorTag, BEFORE_THE_CHANGE, PROMOTION_HEAD, QUOTE_MAX } from '../../src/shared/anchor/message';
import type { Anchor } from '../../src/shared/anchor/anchor';
import { framePasted } from '../../src/shared/composer/pasted-content';
import { PLAN_LEAD } from '../../src/shared/engine/host-prompts';

const PROMOTION_ANCHOR: Anchor = { kind: 'none', label: 'Side question', locator: 'btw' };

/** `promotionMessage` at the pin. */
export function pinPromotionMessage(exchanges: { question: string; response: string }[], text: string | null): string {
  const pairs = exchanges.map(({ question, response }) => `Q: ${question}\nA: ${response}`);
  const typed = text?.trim() || 'Continue from here.';
  return [PROMOTION_HEAD, ...pairs, typed, anchorTag(PROMOTION_ANCHOR)].join('\n\n');
}

/** `planPrompt` at the pin. */
export const pinPlanPrompt = (plan: string): string => `${PLAN_LEAD}\n\n${plan}`;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const QUOTE_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
function quoteLine(line: string): string | null {
  const one = line.replace(/\r$/, '').replace(QUOTE_CONTROL, '�');
  if (/^[ \t]*$/.test(one)) return null;
  if (one.length <= QUOTE_MAX) return one;
  let end = QUOTE_MAX - 1;
  const last = one.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${one.slice(0, end)}…`;
}
function codeSpan(line: string): string {
  const longest = Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(line) ? ' ' : '';
  return `${ticks}${pad}${line}${pad}${ticks}`;
}

/** `quotedComment` at the pin. */
export function pinQuotedComment(anchor: Anchor, quote: string | null, text: string): string {
  if (text.trim() === '') return text;
  const line = quote === null ? null : quoteLine(quote);
  const caption = anchor.kind === 'file-line' && anchor.side === 'old' && anchor.commit === undefined;
  return [...(caption ? [BEFORE_THE_CHANGE] : []), ...(line === null ? [] : [codeSpan(line)]), text].join('\n');
}

/** `wrapPasted` at the pin, for ASCII bodies (its neutraliser read the ASCII spelling only): a forged segment. */
export function pinWrapPasted(id: string, body: string): string {
  const neutral = body.replace(/<(?!\\)(?=\/?pasted_content)/gi, '<\\');
  return `\n\n${framePasted(id, neutral.endsWith('\n') ? neutral.slice(0, -1) : neutral)}\n`;
}
