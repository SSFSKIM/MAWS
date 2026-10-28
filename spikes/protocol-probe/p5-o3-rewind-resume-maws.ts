// P5 O3-F (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md, child O3-F, document blob
// 67da2f63a992c9c6f6369ffe1ff3fc7605999c89 at master 1d1d71937): what MAWS makes of the recorded arms of
// scenarios/pass3/p5-o3-rewind-resume.mjs, read through MAWS's own code rather than restated:
//   live  every launch's journal through the engine host's normaliser (a fresh `Normalizer` per launch, as a launch
//         gets one), the launches' events in order into one renderer transcript state (reduce.ts `applyEvents`, the
//         app session's whole event list across its launches, as `session.events` serves it), and what it shows
//   disk  a transcript the engine left, through the production disk path (fs/chain-follower.ts `ChainFollower`, the
//         backfill, the same reducer), the resume chooser's preview (main/sessions/recent-turns.ts `recentTurnsOf`)
//         and the shared chain reader (shared/wire/transcript.ts `currentChain`, which the replay sources use)
// Findings-only: bundled and run where the workspace is installed (it imports zod through the sources), e.g.
//   pnpm exec esbuild spikes/protocol-probe/p5-o3-rewind-resume-maws.ts --bundle --platform=node --format=esm \
//     --outfile=/tmp/o3f-maws.mjs && node /tmp/o3f-maws.mjs spikes/protocol-probe/fixtures/p5 \
//     > spikes/protocol-probe/fixtures/p5/p5-o3-rewind-resume-maws.json
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { parseJournalRow } from '@shared/wire/journal';
import { currentChain, parseTranscriptRecord } from '@shared/wire/transcript';
import { Normalizer } from '../../src/engine-host/normalizer';
import { ChainFollower } from '../../src/engine-host/fs/chain-follower';
import { recentTurnsOf } from '../../src/main/sessions/recent-turns';
import { applyEvents, createState, type TranscriptState } from '../../src/renderer/src/transcript/model/reduce';
import { rowsOf } from '../../src/renderer/src/transcript/model/derive';
import { MemoryFileReader } from '../../test/support/memory-reader';

const dir = process.argv[2];
const MARKERS = /\b(?:PROMPT|WORKING|REPLY|STATE|CONTENT)_T\d\b/g;
const markers = (s: unknown) => [...new Set(String(s ?? '').match(MARKERS) ?? [])];
const jsonl = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown);

// What a transcript state shows: its turns by label, the turns a rewind hid, and the visible rows that carry text.
function view(state: TranscriptState, label: (s: string) => string) {
  const rows = rowsOf(state);
  const shown = rows.flatMap((row) => {
    const r = row as { kind: string; text?: string; markdown?: string; boundaryKind?: string; hiddenRows?: number };
    if (r.kind === 'user') return [`user ${markers(r.text).join(',') || JSON.stringify(String(r.text).slice(0, 40))}`];
    if (r.kind === 'assistant_text') return [`text ${markers(r.markdown).join(',') || JSON.stringify(String(r.markdown).slice(0, 40))}`];
    if (r.kind === 'boundary') return [`boundary ${r.boundaryKind} hiding ${r.hiddenRows}`];
    return [];
  });
  const counts = new Map<string, number>();
  for (const s of shown) for (const m of markers(s)) counts.set(m, (counts.get(m) ?? 0) + 1);
  return {
    turns: state.order.map(label),
    hiddenTurns: (state.hidden?.turns ?? []).map(label),
    hiddenRows: state.hidden?.rows ?? 0,
    shown,
    twice: [...counts].filter(([, n]) => n > 1).map(([m, n]) => `${m} x${n}`),
  };
}

async function disk(name: string, text: string, sessionId: string, label: (s: string) => string) {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), sessionId as SessionId, null, (e) => { if (e.t === 'events') events.push(...e.events); }, { holders: () => 0 });
  await follower.start();
  follower.stop();
  const records = text.split('\n').filter(Boolean).map((l) => parseTranscriptRecord(JSON.parse(l)));
  const chain = currentChain(records);
  const recent = recentTurnsOf(text, 20, false);
  return {
    snapshot: name,
    follower: { rewinds: events.filter((e) => e.kind === 'boundary.rewind').map((e) => label(String((e as { targetMessageUuid?: string }).targetMessageUuid))), ...view(applyEvents(createState(null, null), events), label) },
    currentChain: { leaf: chain.leaf?.type ?? null, prompts: chain.chain.filter((r) => r.type === 'user').flatMap((r) => markers(JSON.stringify(r.message?.content)).filter((m) => m.startsWith('PROMPT'))) },
    recentTurns: recent.turns.map((t) => `${markers(JSON.stringify(t)).filter((m) => /PROMPT|REPLY/.test(m)).join(',')}`),
  };
}

const out: Record<string, unknown> = {};
const arms = [...new Set(readdirSync(dir).map((f) => /^p5-o3-rewind-resume-(.+)-uuids\.json$/.exec(f)?.[1]).filter((a): a is string => !!a))].sort();
for (const arm of arms) {
  const meta = JSON.parse(readFileSync(join(dir, `p5-o3-rewind-resume-${arm}-uuids.json`), 'utf8')) as { sessionId: string; uuids: Record<string, string> };
  const byUuid = new Map(Object.entries(meta.uuids).map(([k, v]) => [v, k]));
  const label = (s: string) => { const u = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(s)?.[0]; return u && byUuid.has(u) ? byUuid.get(u)! : s.slice(0, 13); };
  const launches = readdirSync(dir).filter((f) => new RegExp(`^p5-o3-rewind-resume-${arm}-l\\d\\.jsonl$`).test(f)).sort();
  let state = createState(null, null);
  const live: unknown[] = [];
  // the snapshots the steps noted, each the final transcript's first `lines` lines (the engine only appends)
  const final = join(dir, 'p5-o3-rewind-resume-transcripts', `p5-o3-rewind-resume-${arm}.jsonl`);
  const finalLines = existsSync(final) ? readFileSync(final, 'utf8').split('\n').filter(Boolean) : [];
  const diskViews = [];
  for (const f of launches) {
    const rows = jsonl(join(dir, f)) as { direction: string; frame: { event?: string; label?: string; lines?: number } }[];
    for (const r of rows) {
      const n = r.frame.lines;
      if (r.direction === 'meta' && r.frame.event === 'transcript_snapshot' && /after-rewind|after-release|after-kill|after-next|end$/.test(r.frame.label ?? '') && typeof n === 'number') {
        diskViews.push(await disk(`${f.slice(-8, -6)} ${r.frame.label} (${n} lines)`, `${finalLines.slice(0, n).join('\n')}\n`, meta.sessionId, label));
      }
    }
    const normalizer = new Normalizer({ appSessionId: `app-o3f-${arm}` as AppSessionId, launchId: f.slice(-8, -6), sessionId: null });
    const events = rows.map(parseJournalRow).flatMap((row) => normalizer.push(row));
    state = applyEvents(state, events);
    live.push({
      launch: f.slice(-8, -6),
      rewinds: events.filter((e) => e.kind === 'boundary.rewind').map((e) => ({ target: label(String((e as { targetMessageUuid?: string }).targetMessageUuid)), prefill: markers((e as { prefillText?: string }).prefillText).join(',') })),
      after: view(state, label),
    });
  }
  out[arm] = { live, disk: diskViews };
}
console.log(JSON.stringify(out, null, 1));
