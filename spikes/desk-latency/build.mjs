// Builds one self-contained script for playwright-cli's run-code (a single `async page => {...}` expression: run-code
// takes no imports, so the harness's modules are inlined) for one load against one target, its configuration baked in.
//
//   node spikes/desk-latency/build.mjs --target desk|rc --load <load> [--cohort cold|warm|reconnect] [--variant v]
//        [--url <origin>] [--project <id>] [--session <id>] [--sessions a,b,…] [--reps N] [--config file.json]
//        [--set key=value]… [--out file.js]
//   playwright-cli -s=chrome --raw run-code --filename=<out> > result.json
//
// The script returns the run as a JSON string (run-code prints it JSON-encoded once more; join.mjs reads either).
// Loads: app, project, session, older-page, send, steer, interrupt, permission, question, spawn, resume, wake, watch,
// probe-page (README.md says what each times).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const LIB = ['stats', 'probe', 'net', 'runner', 'desk-selectors', 'rc-selectors', 'surfaces', 'loads'];

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    load: { type: 'string' },
    cohort: { type: 'string' },
    variant: { type: 'string' },
    url: { type: 'string' },
    project: { type: 'string' },
    session: { type: 'string' },
    sessions: { type: 'string' },
    reps: { type: 'string' },
    config: { type: 'string' },
    set: { type: 'string', multiple: true },
    out: { type: 'string' },
  },
});

const config = values.config ? JSON.parse(readFileSync(values.config, 'utf8')) : {};
for (const key of ['target', 'load', 'cohort', 'variant', 'url', 'project', 'session']) if (values[key] !== undefined) config[key] = values[key];
if (values.sessions !== undefined) config.sessions = values.sessions.split(',').filter(Boolean);
if (values.reps !== undefined) config.reps = Number(values.reps);
for (const pair of values.set ?? []) {
  const at = pair.indexOf('=');
  if (at < 0) throw new Error(`--set takes key=value, not ${pair}`);
  const raw = pair.slice(at + 1);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  config[pair.slice(0, at)] = value;
}
if (config.target !== 'desk' && config.target !== 'rc') throw new Error('--target is desk or rc');
if (!config.load) throw new Error('--load is required');
if (config.target === 'desk' && !config.url) throw new Error('--url (the desk origin) is required for the desk');

const body = LIB.map((name) => {
  const text = readFileSync(new URL(`lib/${name}.mjs`, import.meta.url), 'utf8');
  if (/^import /m.test(text)) throw new Error(`lib/${name}.mjs imports: the inlined modules share one scope and import nothing`);
  return `// ---- lib/${name}.mjs\n${text.replace(/^export /gm, '')}`;
}).join('\n');

const script = `// spikes/desk-latency, ${config.target} ${config.load}${config.cohort ? ` (${config.cohort})` : ''}: built ${new Date().toISOString()} by build.mjs.
// Run: playwright-cli -s=<session> --raw run-code --filename=<this file> > <result>.json
async (page) => {
const CONFIG = ${JSON.stringify(config, null, 2)};
${body}
const S = CONFIG.target === 'rc' ? rcSurface(CONFIG) : deskSurface(CONFIG);
const run = await runHarness(page, CONFIG, makeLoads(S), CONFIG.target === 'rc' ? classifyRc : classifyDesk, S);
return JSON.stringify(run);
}
`;

if (values.out) writeFileSync(values.out, script);
else process.stdout.write(script);
