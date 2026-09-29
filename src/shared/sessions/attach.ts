// The command that attaches to a background job (C10 execution document, Interfaces "Session service", Attach): what
// C9's terminal tab runs. Shared because main names it in a `held` outcome and the renderer builds it for the Attach
// affordance, and the two must be the same string.

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
