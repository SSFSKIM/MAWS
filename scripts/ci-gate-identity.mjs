// Default refs identify the call, not just its commit. Keep explicit labels out of this path: some select final bundles.
import { createHash } from 'node:crypto';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { targetOutputs } from './ci-gate-pool-demand.mjs';

const { values } = parseArgs({ options: { 'git-dir': { type: 'string' }, sha: { type: 'string' }, branch: { type: 'string' } } });
const list = (value) => [...new Set(value.split(/[\s,]+/).filter(Boolean))].sort().join(',');
// Hash semantic trailers, never the nonce or advisory text. Normalize sets before asking the committed planner too.
const trailers = (process.env.HEAD_MESSAGE ?? '').split('\n').filter((line) => line && !/^(Nonce|Pool-Demand|Unit-Coverage|E2E-Coverage):/.test(line)).map((line) =>
  line.replace(/^(Gates|DefaultBeside):\s*(.*)$/, (_, key, value) => `${key}: ${list(value)}`),
).sort();
const message = trailers.join('\n');
const get = (key) => new RegExp(`^${key}: (.*)$`, 'm').exec(message)?.[1] ?? '';
const variables = Object.fromEntries(['GATE_RUNNER', 'GATE_E2E_RUNNER', 'HOSTED_MAC_ROUTE'].map((key) => [key, process.env[key] ?? '']));
let outputs = null;
try {
  outputs = targetOutputs(values['git-dir'], values.sha, message);
} catch {
  // As with the pool hint, a missing/older planner must not prevent launching. Inputs still distinguish calls.
  process.stderr.write('ci-gate: warning: default label uses configuration only; the committed plan could not be resolved\n');
}
const branch = values.branch || 'gate';
const hash = createHash('sha256').update(JSON.stringify({ branch, trailers, variables, outputs })).digest('hex').slice(0, 12);
const slug = (text, max) => text.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, max);
const kind = `${get('Gates') || 'all'}-${get('Lane') || get('Class1a') || variables.GATE_RUNNER || 'linux'}`;
// The prefix also prevents a branch like h-final-diagnostic from matching gate-plan's reserved final-ref prefixes.
process.stdout.write(`auto-${slug(branch, 24)}-${slug(kind, 32)}-${hash}\n`);
