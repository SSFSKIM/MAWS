// Attaching to a background job (C10 execution document, Interfaces "Session service", Attach): the command C9's
// terminal tab runs, and the matcher for the engine's own refusal to resume a `--bg` session, which is authoritative
// over MAWS's holder read (a job started in the window between that read and the launch).

// SPEC §35 27.1; fixture pass2/resume-live-bg.jsonl seq 5: "… is running as a background session (e6dcd828). Run
// `claude attach e6dcd828` to open it …".
export const BG_REFUSAL = /is running as a background session(?: \(([0-9a-f]{8})\))?/;

export function bgRefusalOf(text: string): { jobId: string | null } | null {
  const match = BG_REFUSAL.exec(text);
  return match ? { jobId: match[1] ?? null } : null;
}

const PLAIN = /^[A-Za-z0-9._/-]+$/;
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// The pinned binary (`engine.binaryInfo.path`; the owner's login shell may resolve `claude` to a wrapper), always
// single-quoted; the job's short id as it is, or quoted if it were ever anything but a plain word. C9's `pty.spawn`
// writes the command after spawn followed by a newline.
export function attachCommand(binaryPath: string, jobId: string): string {
  return `${shellQuote(binaryPath)} attach ${PLAIN.test(jobId) ? jobId : shellQuote(jobId)}`;
}
