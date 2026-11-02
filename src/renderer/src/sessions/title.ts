// A session's title as every surface shows it (W11, I1): the record's title, or "New chat" while it has none (a launch
// before its first prompt is indexed, a fork without a message, a session after `/clear` before its next message) and
// for a session with no record yet (an unstarted tab). Main's projection (`titleOf` in `main/index/sessions.ts`) answers
// override, custom title, AI title, then the first prompt; this is the one renderer fallback after it.
import type { SessionRecord } from '@shared/graph/session';

export const NEW_CHAT = 'New chat';

export function displayTitle(record: Pick<SessionRecord, 'title'> | null | undefined): string {
  const text = record?.title.text ?? '';
  return text.trim() === '' ? NEW_CHAT : text;
}

// P5 O8 M2: a listed row's title (another machine's session as its listing says it), "New chat" while its listing has
// none, as `displayTitle` reads a record's.
export const listedTitle = (listed: { title: string }): string => (listed.title.trim() === '' ? NEW_CHAT : listed.title);
