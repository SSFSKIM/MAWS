// P5 O15 M2b §H (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): an error in the words a log line carries.
// A connect that failed on several addresses is Node's aggregate, whose own message is empty, so a line that kept only
// `message` said nothing of why (P5 Decision Log 262: the 71 s `mawsd` took to reach the hub, with no cause logged).
// The words are the message; then, in parentheses, the code and each inner error's code, address and port.
//   connect ETIMEDOUT (ETIMEDOUT; ETIMEDOUT 192.0.2.1:443, ENETUNREACH 2001:db8::1:443)

type Fields = { message?: unknown; code?: unknown; errors?: unknown; address?: unknown; port?: unknown };

const said = (value: unknown): string => (typeof value === 'string' ? value : '');
const joined = (parts: string[], by: string): string => parts.filter((part) => part !== '').join(by);

export function errorWords(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const { message, code, errors } = error as Fields;
  const inner = Array.isArray(errors) ? joined(errors.map(innerWords), ', ') : '';
  const detail = joined([said(code), inner], '; ');
  const words = joined([said(message), detail === '' ? '' : `(${detail})`], ' ');
  if (words !== '') return words;
  return error instanceof Error ? error.name : String(error);
}

/** One inner error: its code (its message where it has none), and where it was going. */
function innerWords(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const { message, code, address, port } = error as Fields;
  const where = typeof address === 'string' ? (typeof port === 'number' ? `${address}:${port}` : address) : '';
  return joined([said(code) || said(message), where], ' ');
}
