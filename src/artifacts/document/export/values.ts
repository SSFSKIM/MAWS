// What an inline atom shows as text in an exported file (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md),
// shared by the HTML and DOCX exporters: a date in the display locale read as a calendar day (no time zone shift, as
// the editor's chip draws it; `@shared/app/date-format`), a mention by its label, a dropdown by its value. Portable.
import type { Node as PMNode } from '@tiptap/pm/model';
import { formatCalendarDay } from '@shared/app/date-format';

/** `2026-10-12` as `Oct 12, 2026`; anything that is not a calendar day as written. */
export function formatDate(iso: unknown): string {
  const text = typeof iso === 'string' ? iso : '';
  return formatCalendarDay(text) ?? text;
}

/** A chip's text: the date, the mention's label or the dropdown's value. */
export function chipText(node: PMNode): string {
  switch (node.type.name) {
    case 'date':
      return formatDate(node.attrs.iso);
    case 'mention':
      return String(node.attrs.label ?? '');
    case 'dropdown':
      return String(node.attrs.value ?? '');
    default:
      return node.textContent;
  }
}
