// Search snippets can begin or end inside a mark, so hide known wrapper tokens without requiring a balanced pair.
// Quoted vocabulary remains literal, as in the transcript's grammar; unrelated tags are not ours to rewrite.
import { codeRegions, insideCode } from '@shared/owner/to-human-parser';

export function conversationSnippet(text: string): string {
  const inCode = insideCode(codeRegions(text));
  return text.replace(/<\/?(?:message|to-human|essential|need-input|insight)>|<choice(?: recommended)?>|<\/choice>/g,
    (tag: string, offset: number) => inCode(offset) ? tag : '');
}
