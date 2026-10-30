// The engine's own refusal to resume a `--bg` session (C10 execution document, Interfaces "Session service", Attach),
// which is authoritative over MAWS's holder read (a job started in the window between that read and the launch). The
// attach command itself is shared with the renderer (`@shared/sessions/attach`).

// SPEC §35 27.1; fixture pass2/resume-live-bg.jsonl seq 5: "… is running as a background session (e6dcd828). Run
// `claude attach e6dcd828` to open it …".
export const BG_REFUSAL = /is running as a background session(?: \(([0-9a-f]{8})\))?/;

export function bgRefusalOf(text: string): { jobId: string | null } | null {
  const match = BG_REFUSAL.exec(text);
  return match ? { jobId: match[1] ?? null } : null;
}
