// Joins the harness's runs (one JSON per run-code invocation, desk and claude.ai/code alike) and the machine's side of
// the same window (machine.mjs) into the baseline: per cohort, each load's end-to-end figure on both apps, how far the
// desk is behind, and where its time goes.
//
//   node spikes/desk-latency/join.mjs <run.json>… [--machine machine.json]… [--json joined.json] > baseline.md
//
// A repetition becomes milestones, each in ms after its start mark: the visible effects (`marks`, but for one counted
// from elsewhere, `from`), the frames (`net.*`), the desk's own samples (`app:<path>`, each at its end; `app:subscribed`
// the first rows' start), a cold load's gates (`t:*`), and the machine's (`m:*`: the per-open line by subscription id,
// the transcript rows carrying the repetition's token, the RPC ledger by nonce, a Remote Control debug log by uuid or
// request id). daemon.log's delivery lines name no item, only the project and the recipient, so they are counted per
// window, never joined to a repetition. A group's milestones in median order are its timeline; its costliest hop is
// the widest gap between consecutive ones up to the load's end-to-end mark.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { describe } from './lib/stats.mjs';

/** Each load's end-to-end mark: the visible effect the person waits for. */
export const PRIMARY = {
  app: 'useful',
  project: 'useful',
  session: 'useful',
  'older-page': 'grew',
  send: 'firstToken',
  steer: { desk: 'steered', rc: ['steered', 'net.consumed'] },
  interrupt: 'stopped',
  permission: 'decide.gone',
  question: 'answer.gone',
  spawn: 'firstToken',
  resume: 'useful',
  wake: 'current',
};

const OPENS = new Set(['app', 'project', 'session']);
export const cohortOf = (run) => run.config?.cohort ?? (OPENS.has(run.load) ? 'cold' : run.load === 'wake' || run.load === 'watch' ? 'reconnect' : 'warm');
/** A load's end mark on a target: the first of its candidates the group measured (claude.ai/code's steer read, else the
 * frame of it consumed). */
export const primaryOf = (load, target, stats = null) => {
  const p = PRIMARY[load];
  const candidates = [typeof p === 'object' && p !== null && !Array.isArray(p) ? p[target] : p].flat().filter(Boolean);
  return candidates.find((c) => !stats || stats[c]?.n) ?? candidates[0] ?? null;
};

export function readRun(text) {
  let value = JSON.parse(text);
  if (typeof value === 'string') value = JSON.parse(value); // run-code prints the script's JSON string encoded once more
  return value;
}

/** A repetition's milestones, ms after its start mark. */
export function milestones(rep, run, machines = []) {
  const out = {};
  const startWall = rep.start?.wall ?? null;
  for (const [name, m] of Object.entries(rep.marks ?? {})) if (m?.ms != null && !m.already && m.from === undefined) out[name] = m.ms;
  for (const [name, v] of Object.entries(rep.net ?? {})) if (typeof v === 'number') out[`net.${name}`] = v;
  for (const [name, v] of Object.entries(rep.timeline ?? {})) if (typeof v === 'number') out[`t:${name}`] = v;
  if (startWall === null) return out;
  const rel = (wall) => Math.round((wall - startWall) * 10) / 10;
  const samples = rep.inApp ?? [];
  for (const s of samples) {
    if (s.at < startWall - 1) continue;
    if (rep.timeline && TIMELINE_PATHS.has(s.path)) continue; // a cold load's timeline names these already (`t:*`)
    const key = `app:${s.path}`;
    if (out[key] === undefined && !CROSS_CLOCK.has(s.path)) out[key] = rel(s.at);
    if (s.path === 'view.first-rows' && out['app:subscribed'] === undefined) out['app:subscribed'] = rel(s.at - s.ms);
  }
  let toolUseAt = null; // the wall time of the tool call's row carrying the token
  for (const machine of machines) {
    const d = machine.daemon;
    if (d) {
      // The open the repetition's subscription made, by its id: the subscribe's arrival and the snapshot emitted.
      const sub = samples.find((s) => s.path === 'view.snapshot')?.ref ?? rep.ids?.sub;
      const open = sub ? d.opens.find((o) => o.sub === sub) : null;
      if (open) {
        out['m:arrival'] = rel(open.arrival);
        out['m:snapshot'] = rel(open.at);
      }
    }
    const nonce = rep.ids?.nonce;
    const entry = nonce ? machine.rpcs?.find((e) => e.nonce === nonce) : null;
    if (entry) {
      out['m:claimed'] = rel(entry.claimed);
      if (entry.done) out['m:done'] = rel(entry.done);
    }
    if (rep.token) {
      // From the repetition's first start: a raise's prompt was sent before the decision the repetition starts at.
      const since = Math.min(startWall, rep.raise?.start?.wall ?? startWall) - 1000;
      for (const rows of Object.values(machine.transcripts ?? {})) {
        const mine = rows.filter((r) => r.tokens.includes(rep.token) && r.at >= since);
        const user = mine.find((r) => r.type === 'user' && r.toolResults.length === 0);
        const call = mine.find((r) => r.toolUses.length > 0);
        const reply = mine.find((r) => r.type === 'assistant' && r.toolUses.length === 0);
        if (user && out['m:row'] === undefined) out['m:row'] = rel(user.at);
        if (call && toolUseAt === null) {
          toolUseAt = call.at;
          out['m:tool_use'] = rel(call.at);
        }
        if (reply && out['m:reply'] === undefined) out['m:reply'] = rel(reply.at);
      }
    }
    const uuid = rep.ids?.uuid;
    for (const e of machine.rc ?? []) {
      if (e.at < startWall - 1000) continue;
      if (uuid && e.uuid === uuid && e.kind === 'ingress' && out['m:ingress'] === undefined) out['m:ingress'] = rel(e.at);
      if (uuid && e.uuid === uuid && e.kind === 'inject' && out['m:inject'] === undefined) out['m:inject'] = rel(e.at);
      if (rep.ids?.request_id && e.request_id === rep.ids.request_id && out['m:responded'] === undefined) out['m:responded'] = rel(e.at);
    }
  }
  // The raise, on the same method for both apps: from the tool call's row on the machine until its card is painted, both
  // wall times (the card's mark counts from the prompt's Enter, the repetition from its later decision).
  const card = rep.marks?.['raise.card'];
  if (card?.wall != null && toolUseAt !== null) out['raise.machine'] = Math.round((card.wall - toolUseAt) * 10) / 10;
  return out;
}

/** The desk's paths a cold load's timeline (`coldTimeline` in lib/loads.mjs) already carries. */
const TIMELINE_PATHS = new Set(['app.me', 'app.key', 'app.grid', 'project.caught-up', 'view.snapshot', 'view.first-rows']);

/** Paths whose ms is cross-clock or whose time is not this repetition's: not a milestone of it. */
const CROSS_CLOCK = new Set(['stream.chunk', 'stream.row', 'session.message', 'owner.row', 'request.row']);

/**
 * Per group: every milestone described, the timeline in median order, and its widest gap up to the primary mark. The
 * raise's marks (`raise.*`) count from the prompt's Enter or the machine's row, not the repetition's start: kept out.
 */
export function summarizeGroup(reps, primary) {
  const by = {};
  for (const ms of reps) for (const [k, v] of Object.entries(ms)) (by[k] ??= []).push(v);
  const stats = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, describe(v)]));
  const end = primary && stats[primary] ? stats[primary].p50 : null;
  const timeline = Object.entries(stats)
    .filter(([k, s]) => s.p50 !== null && s.p50 >= 0 && !k.startsWith('raise.') && (end === null || s.p50 <= end))
    .sort((a, b) => a[1].p50 - b[1].p50)
    .map(([k, s]) => [k, s.p50]);
  let costliest = null;
  let prev = ['start', 0];
  for (const [k, v] of timeline) {
    const gap = v - prev[1];
    if (!costliest || gap > costliest.ms) costliest = { from: prev[0], to: k, ms: Math.round(gap * 10) / 10 };
    prev = [k, v];
  }
  return { n: reps.length, stats, timeline, costliest };
}

export function join(runs, machines) {
  const groups = new Map();
  for (const run of runs) {
    if (run.load === 'probe-page' || run.load === 'watch') continue;
    const key = [cohortOf(run), run.load, run.variant ?? '', run.target].join('|');
    const g = groups.get(key) ?? { cohort: cohortOf(run), load: run.load, variant: run.variant ?? null, target: run.target, reps: [] };
    for (const rep of run.reps ?? []) g.reps.push(milestones(rep, run, machines));
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    const first = summarizeGroup(g.reps, null);
    const primary = primaryOf(g.load, g.target, first.stats);
    out.push({ ...g, reps: undefined, primary, ...summarizeGroup(g.reps, primary) });
  }
  return out;
}

const fmt = (v) => (v === null || v === undefined ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)}`);

/** The baseline as Markdown: per cohort a table of the loads on both apps, then the desk's offenders, ranked. */
export function render(groups, machines, runs) {
  const lines = ['# Desk vs Remote Control: the baseline', '', 'ms unless marked; p95 over fewer than 20 repetitions is marked * (within a sample or two of the max).', ''];
  const rows = new Map();
  for (const g of groups) {
    const key = [g.cohort, g.load, g.variant ?? ''].join('|');
    const r = rows.get(key) ?? { cohort: g.cohort, load: g.load, variant: g.variant };
    r[g.target] = g;
    rows.set(key, r);
  }
  const offenders = [];
  for (const cohort of ['cold', 'warm', 'reconnect']) {
    const these = [...rows.values()].filter((r) => r.cohort === cohort);
    if (!these.length) continue;
    lines.push(`## ${cohort}`, '', '| load | end mark | desk n | desk p50 | desk p95 | RC n | RC p50 | RC p95 | Δp50 | Δp95 | desk\'s costliest hop (median) |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of these) {
      const d = r.desk?.stats?.[r.desk.primary];
      const c = r.rc?.stats?.[r.rc.primary];
      const delta = (a, b) => (a && b && a !== null && b !== null ? a - b : null);
      const dp50 = delta(d?.p50, c?.p50);
      const dp95 = delta(d?.p95, c?.p95);
      const hop = r.desk?.costliest ? `${r.desk.costliest.from} → ${r.desk.costliest.to}: ${fmt(r.desk.costliest.ms)}` : '–';
      lines.push(`| ${r.load}${r.variant ? ` (${r.variant})` : ''} | ${r.desk?.primary ?? r.rc?.primary ?? '–'} | ${d?.n ?? 0} | ${fmt(d?.p50)} | ${fmt(d?.p95)}${d?.low ? '*' : ''} | ${c?.n ?? 0} | ${fmt(c?.p50)} | ${fmt(c?.p95)}${c?.low ? '*' : ''} | ${fmt(dp50)} | ${fmt(dp95)} | ${hop} |`);
      if (dp95 !== null || dp50 !== null) offenders.push({ ...r, dp50, dp95 });
    }
    lines.push('');
  }
  lines.push('## Where the desk falls behind, worst first', '');
  offenders.sort((a, b) => (b.dp95 ?? b.dp50 ?? 0) - (a.dp95 ?? a.dp50 ?? 0));
  for (const o of offenders) {
    lines.push(`### ${o.cohort} ${o.load}${o.variant ? ` (${o.variant})` : ''}: Δp95 ${fmt(o.dp95)}, Δp50 ${fmt(o.dp50)}`);
    for (const target of ['desk', 'rc']) {
      const g = o[target];
      if (!g) continue;
      lines.push(`- ${target}: ${g.timeline.map(([k, v]) => `${k} ${fmt(v)}`).join(' → ')}${g.costliest ? `; costliest ${g.costliest.from} → ${g.costliest.to} (${fmt(g.costliest.ms)})` : ''}`);
    }
    lines.push('');
  }
  const raises = groups.filter((g) => g.stats['raise.machine'] || g.stats['raise.card']);
  if (raises.length) {
    lines.push(
      '## A request raised until its card is drawn',
      '',
      "From the tool call's row on the machine (`raise.machine`, the same method on both apps), and from the prompt's Enter (`raise.card`, which carries the model's time to the call), until the card is painted.",
      '',
      '| load | target | row → card n | p50 | p95 | Enter → card n | p50 | p95 |',
      '|---|---|---|---|---|---|---|---|',
    );
    const cells = (s) => `${s?.n ?? 0} | ${fmt(s?.p50)} | ${fmt(s?.p95)}${s?.low ? '*' : ''}`;
    for (const g of raises) lines.push(`| ${g.load} | ${g.target} | ${cells(g.stats['raise.machine'])} | ${cells(g.stats['raise.card'])} |`);
    lines.push('');
  }
  for (const m of machines) {
    const d = m.daemon;
    if (!d) continue;
    const rec = describe(d.recycles.filter((r) => r.ms !== null && !r.restarted).map((r) => r.ms));
    const opens = describe(d.opens.map((o) => o.ms));
    lines.push(`## Machine ${m.machine}${m.skewMs ? ` (skew ${m.skewMs} ms subtracted; cross-clock figures carry its error)` : ''}`, '');
    lines.push(`- hub stream recycles: n ${rec.n}, p50 ${fmt(rec.p50)}, p95 ${fmt(rec.p95)}, max ${fmt(rec.max)}; causes ${JSON.stringify(Object.fromEntries(Object.entries(groupBy(d.recycles, (r) => r.cause)).map(([k, v]) => [k, v.length])))}`);
    lines.push(`- opens (subscribe's arrival → snapshot emitted): n ${opens.n}, p50 ${fmt(opens.p50)}, p95 ${fmt(opens.p95)}, max ${fmt(opens.max)}`);
    lines.push(`- sender lanes: ${d.lanes.dialled} dials, ${d.lanes.posts} POSTs; slow POSTs (> 5 s) ${d.slowPosts.length}`);
    lines.push(`- deliveries (the daemon's \`delivered\` lines, which name no item: per window, not per repetition): ${d.delivered.length} lines, ${d.delivered.reduce((n, x) => n + x.count, 0)} events`);
    lines.push('');
  }
  const watches = runs.filter((r) => r.load === 'watch');
  for (const w of watches) {
    const drops = (w.reps ?? []).flatMap((r) => r.drops ?? []);
    const s = describe(drops.map((d) => d.ms));
    lines.push(`## Watched (${w.target}${w.variant ? `, ${w.variant}` : ''}): every drop the app showed until useful again`, '', `n ${s.n}, p50 ${fmt(s.p50)}, p95 ${fmt(s.p95)}, max ${fmt(s.max)}`, '');
  }
  return lines.join('\n');
}

function groupBy(list, key) {
  const out = {};
  for (const x of list) (out[key(x)] ??= []).push(x);
  return out;
}

// Run as a command (not imported by the tests): argv[1] through any symlink (/tmp is one on macOS).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { machine: { type: 'string', multiple: true }, json: { type: 'string' } } });
  const runs = positionals.map((f) => readRun(readFileSync(f, 'utf8')));
  const machines = (values.machine ?? []).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const groups = join(runs, machines);
  if (values.json) writeFileSync(values.json, JSON.stringify(groups, null, 1));
  process.stdout.write(`${render(groups, machines, runs)}\n`);
}
