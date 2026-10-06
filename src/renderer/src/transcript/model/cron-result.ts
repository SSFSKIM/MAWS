// CronCreate's result text, parsed (SPEC 22 §22.9; E7 execution document, Design §7): `Scheduled recurring job <id>
// (<humanSchedule>). <store>. Auto-expires …` or `Scheduled one-shot task <id> (<humanSchedule>). <store>. It will
// fire …`, the store `Persisted to .claude/scheduled_tasks.json` or `Session-only (…)`. A one-shot's schedule is the
// raw cron (E7 M0, pass3/e7-cron seq 101). Null for any other text. Pure.

export interface CronCreated {
  id: string;
  humanSchedule: string;
  recurring: boolean;
  durable: boolean;
}

const CREATED = /^Scheduled (recurring job|one-shot task) (\S+) \((.+?)\)\. (Persisted to \.claude\/scheduled_tasks\.json|Session-only \(not written to disk, dies when Claude exits\))\./;

export function parseCronResult(text: string): CronCreated | null {
  const match = CREATED.exec(text.trim());
  if (!match) return null;
  return { id: match[2]!, humanSchedule: match[3]!, recurring: match[1] === 'recurring job', durable: match[4]!.startsWith('Persisted') };
}
