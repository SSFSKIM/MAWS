// E10 M0 Q5 (docs/doperpowers/plans/2026-10-06-e10-supervisor.md, M0): the installed engine's registry row
// (`<CLAUDE_CONFIG_DIR>/sessions/<pid>.json`) under a detached parent, and after that parent died. It shares Q1's live
// run (the M0 budget allows one): q1-engine-parent-death.mjs snapshots the row while the wrapper (the host's
// stand-in) is the engine's parent and again at the first sample after the wrapper's SIGKILL, when the engine's PPID
// is 1. This script reads results/q1-parent-killed.json and checks what C4's holder rule
// (src/engine-host/fs/holders.ts: own when `entrypoint === 'sdk-ts'` and the pid is one of the process table's) needs:
// the row names the engine's own pid and `sdk-ts` under either parent, and carries no field naming its parent.
//   node spikes/supervisor-probe/q1-engine-parent-death.mjs   (the live run, first)
//   node spikes/supervisor-probe/q5-registry.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const q1 = JSON.parse(readFileSync(new URL('./results/q1-parent-killed.json', import.meta.url), 'utf8'));
const before = q1.beforeKill;
const orphan = q1.afterKill.firstOrphanSample;
const checks = [
  ['parent alive: the engine is a session leader whose parent is the wrapper', before.engine.ppid === before.wrapperPid && before.engine.pgid === before.engine.pid && before.engine.stat.includes('s')],
  ['parent alive: the row names the engine pid', before.registry?.pid === before.engine.pid],
  ['parent alive: entrypoint sdk-ts, kind interactive', before.registry?.entrypoint === 'sdk-ts' && before.registry?.kind === 'interactive'],
  ['parent dead: the engine reparented to launchd (PPID 1) within the first 100 ms sample', orphan?.ppid === 1],
  ['parent dead: the row is unchanged in pid, session, entrypoint', orphan?.registry?.pid === before.engine.pid && orphan?.registry?.sessionId === before.registry?.sessionId && orphan?.registry?.entrypoint === 'sdk-ts'],
  ['the row has no field naming a parent', !before.registry.keys.some((k) => /parent|ppid/i.test(k))],
  ['the row was gone no later than the engine vanished from ps (it outlived the parent, per the parent-dead check, and did not outlive the engine)', q1.afterKill.registryGoneMs !== null && q1.afterKill.registryGoneMs <= q1.afterKill.engineGoneMs],
];
const result = {
  question: 'Q5', source: 'results/q1-parent-killed.json', engine: q1.engine,
  rowWhileParentAlive: before.registry, rowAfterParentDeath: orphan?.registry ?? null,
  checks: checks.map(([label, ok]) => ({ label, ok })), allOk: checks.every(([, ok]) => ok),
};
writeFileSync(new URL('./results/q5.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result, null, 1));
