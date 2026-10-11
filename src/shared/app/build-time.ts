// E11 §2.7: a build time as the owner reads it, in local time: Diagnostics' app build row and the running instance's
// word to a newer launch. The month, day and clock follow the system display locale ("Oct 8, 2:05 PM", "10월 8일 오후
// 2:05"; D2 widened at the P2-F sitting); `locale` pins one for a test. An unreadable time is shown as it came.
export function builtAtLabel(iso: string, locale?: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
