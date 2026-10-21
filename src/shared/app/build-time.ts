// E11 §2.7: a build time as the owner reads it, in local time: Diagnostics' app build row and the running instance's
// word to a newer launch. The month, day and clock are the display locale's ("Oct 8, 2:05 PM"; English throughout, P4
// Decision Log 4). An unreadable time is shown as it came.
import { formatDayTime } from './date-format';

export function builtAtLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : formatDayTime(at.getTime());
}
