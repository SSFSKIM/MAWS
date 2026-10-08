// E11 §2.7: a build time as the owner reads it, in local time ("Oct 8, 02:05"): Diagnostics' app build row and the running
// instance's word to a newer launch. An unreadable time is shown as it came.
export function builtAtLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
