// P5 O3-F's spike (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md, child O3-F; scenarios/pass3/p5-o3-rewind-resume.mjs;
// findings-p5-o3-rewind-resume.txt): the recorded claims, read from the fixtures. A step note holds every request the
// scripted API answered, each with `context` (the blocks the model was given, in brief) and `counts` (each marker's
// blocks); the first request of a turn is the context that turn starts from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('./fixtures/p5/', import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), 'utf8');
const rowsOf = (name) => read(name).trim().split('\n').map(JSON.parse);
const ARMS = ['pre', 'pre-files', 'post', 'pre-release', 'same-release', 'plain-release', 'kill-after-rewind', 'kill-after-rewind-200ms', 'kill-after-rewind-1s'];
const killed = (f) => /kill-after-rewind.*-l2\.jsonl$/.test(f); // ended by SIGKILL on purpose
const launches = (arm) => readdirSync(dir).filter((f) => new RegExp(`^p5-o3-rewind-resume-${arm}-l\\d\\.jsonl$`).test(f)).sort();
const uuids = (arm) => JSON.parse(read(`p5-o3-rewind-resume-${arm}-uuids.json`)).uuids;
const notes = (arm, event) => launches(arm).flatMap((f) => rowsOf(f).filter((r) => r.direction === 'meta' && r.frame.event === event).map((r) => ({ launch: f.slice(-8, -6), ...r.frame })));
const firstRequest = (arm, turn) => { const s = notes(arm, 'step').find((n) => n.label === turn); return s.requests.find((q) => q.kind === 'main' && q.step === 0); };
const readResult = (arm, turn) => notes(arm, 'step').find((n) => n.label === turn).requests.find((q) => q.kind === 'main' && q.step === 1).context.at(-1);
const markersOf = (q) => Object.keys(q.counts).sort();
const turnsIn = (q) => [...new Set(markersOf(q).filter((m) => /^(PROMPT|REPLY)_/.test(m)).map((m) => m.split('_')[1]))].sort();
const snapshot = (arm, label) => notes(arm, 'transcript_snapshot').find((n) => n.label === label);

for (const arm of ARMS) test(`p5/${arm}: P5-O3-F provenance on the pinned engine, no managed settings, every launch exits 0 (a kill arm's l2 by SIGKILL), the owner file unchanged, no secret`, () => {
  for (const f of launches(arm)) {
    const text = read(f);
    assert.ok(!text.includes('sk-ant-'), f);
    const rows = text.trim().split('\n').map(JSON.parse);
    const prov = rows.find((r) => r.frame.event === 'provenance').frame;
    assert.deepEqual([prov.child, prov.engineVersion, prov.pin, prov.document], ['P5-O3-F', '2.1.283', '67da2f63a992c9c6f6369ffe1ff3fc7605999c89', 'docs/doperpowers/plans/2026-10-28-p5-o3-spine.md'], f);
    assert.deepEqual(prov.managedSettings, [], f);
    assert.ok(rows.filter((r) => r.frame.event === 'check').every((r) => r.frame.ok), f);
    if (killed(f)) assert.ok(rows.some((r) => r.frame.event === 'exit' && r.frame.signal === 'SIGKILL'), f);
    else {
      assert.ok(rows.some((r) => r.frame.event === 'exit' && r.frame.code === 0), f);
      assert.equal(rows.filter((r) => r.frame.event === 'owner_file_check').at(-1).frame.same, true, f);
    }
    // no request body ever held a block twice
    for (const s of rows.filter((r) => r.frame.event === 'step')) for (const q of s.frame.requests.filter((q) => q.kind === 'main')) assert.deepEqual(q.twice, [], `${f} ${s.frame.label} #${q.n}`);
  }
});

test('p5 O3-F (1) a rewind to a message from before the --resume succeeds, anchors at once, and the next turn and the next resume carry neither the target nor what followed it, nothing twice', () => {
  for (const arm of ['pre', 'pre-files']) {
    const u = uuids(arm);
    assert.equal(notes(arm, 'step').find((n) => n.label === 'T2').launch, 'l1');
    const [rw] = notes(arm, 'rewind');
    assert.equal(rw.launch, 'l2');
    assert.deepEqual([rw.target, rw.lastSeen], [u.T2, u.T3]);
    assert.equal(rw.conversation.subtype, 'success');
    assert.deepEqual([rw.conversation.response.rewound, rw.conversation.response.targetMessageUuid], [true, u.T2]);
    // the anchor is the record the rewind appended, before any next prompt
    const after = snapshot(arm, 'l2-after-rewind');
    assert.deepEqual(after.records.at(-1).type === 'last-prompt' && [after.records.at(-1).rewound, after.lines - snapshot(arm, 'l2-before-rewind').lines], [true, 1]);
    assert.deepEqual(turnsIn(firstRequest(arm, 'T4')), ['T1', 'T4']);
    assert.deepEqual(turnsIn(firstRequest(arm, 'T5')), ['T1', 'T4', 'T5']);
    for (const turn of ['T4', 'T5']) for (const m of ['PROMPT_T2', 'WORKING_T2', 'REPLY_T2', 'CONTENT_T2', 'PROMPT_T3', 'WORKING_T3', 'REPLY_T3', 'CONTENT_T3']) assert.equal(firstRequest(arm, turn).counts[m], undefined, `${arm} ${turn} ${m}`);
  }
});

test('p5 O3-F (2) rewindFiles restores the earlier process\'s checkpoint: the dry run lists the three files, the restore leaves T1\'s state', () => {
  const [rw] = notes('pre-files', 'rewind');
  assert.equal(rw.filesDryRun.response.canRewind, true);
  assert.deepEqual(rw.filesDryRun.response.filesChanged.map((f) => f.split('/').at(-1)).sort(), ['T2.txt', 'T3.txt', 'state.txt']);
  assert.deepEqual(rw.filesRestore.response, { canRewind: true, skippedLinks: 0 });
  assert.deepEqual(snapshot('pre-files', 'l2-after-rewind').files, { 'T1.txt': 'CONTENT_T1', 'state.txt': 'STATE_T1' });
  assert.ok(readResult('pre-files', 'T4').endsWith('STATE_T1')); // the next turn reads the restored file
});

test('p5 O3-F (3, control) a rewind with files to the first message after the resume behaves the same', () => {
  const u = uuids('post');
  const [rw] = notes('post', 'rewind');
  assert.deepEqual([rw.launch, rw.target, rw.conversation.response.rewound, rw.filesRestore.response.canRewind], ['l2', u.T3, true, true]);
  assert.deepEqual(snapshot('post', 'l2-after-rewind').files, { 'T1.txt': 'CONTENT_T1', 'T2.txt': 'CONTENT_T2', 'state.txt': 'STATE_T2' });
  assert.deepEqual(turnsIn(firstRequest('post', 'T5')), ['T1', 'T2', 'T5']);
  assert.deepEqual(turnsIn(firstRequest('post', 'T6')), ['T1', 'T2', 'T5', 'T6']);
});

test('p5 O3-F a rewind followed by a release with nothing sent survives the resume; the rewound turn\'s write reaches the model only as a changed-on-disk note', () => {
  for (const [arm, turn] of [['pre-release', 'T3'], ['same-release', 'T3']]) {
    const q = firstRequest(arm, turn);
    assert.deepEqual(turnsIn(q), ['T1', 'T3'], arm);
    for (const m of ['PROMPT_T2', 'WORKING_T2', 'REPLY_T2', 'CONTENT_T2']) assert.equal(q.counts[m], undefined, `${arm} ${m}`);
    assert.equal(q.counts.STATE_T2, 1, arm); // the reminder that state.txt changed on disk (the conversation rewind kept the file)
    assert.match(readResult(arm, turn), /Wasted call/, arm);
  }
  assert.ok(readResult('plain-release', 'T3').endsWith('STATE_T2')); // the control: no rewind, the Read returns the file
  // the Load now rewind (a resumed process that never had a prompt) anchors without `lastPrompt`
  const anchor = snapshot('pre-release', 'l2-after-rewind').records.at(-1);
  assert.deepEqual([anchor.type, anchor.rewound, anchor.lastPrompt], ['last-prompt', true, '""']);
});

test('p5 O3-F a SIGKILL at once after a successful rewind loses its anchor and the resume brings the rewound turn back; at 200 ms or 1 s the anchor holds', () => {
  const lost = notes('kill-after-rewind', 'transcript_snapshot');
  const atKill = lost.find((n) => n.label === 'l2-after-kill');
  assert.equal(notes('kill-after-rewind', 'rewind')[0].conversation.response.rewound, true);
  assert.equal(atKill.lines, lost.find((n) => n.label === 'l2-start').lines); // nothing reached the transcript
  assert.deepEqual(turnsIn(firstRequest('kill-after-rewind', 'T3')), ['T1', 'T2', 'T3']);
  for (const arm of ['kill-after-rewind-200ms', 'kill-after-rewind-1s']) {
    const anchor = snapshot(arm, 'l2-after-kill').records.at(-1);
    assert.deepEqual([anchor.type, anchor.rewound], ['last-prompt', true], arm);
    assert.deepEqual(turnsIn(firstRequest(arm, 'T3')), ['T1', 'T3'], arm);
  }
  // MAWS's event log took the boundary from the answer, so it hides T2 although the engine resumed with it
  const maws = JSON.parse(read('p5-o3-rewind-resume-maws.json'))['kill-after-rewind'];
  assert.deepEqual(maws.live.at(-1).after.hiddenTurns, ['T2']);
  assert.deepEqual(maws.disk.at(-1).follower.turns, ['T1', 'T2', 'T3']);
});

test('p5 O3-F MAWS: the live path and the chain follower hide the rewound turns across launches; the resume preview misses the Load now anchor', () => {
  const maws = JSON.parse(read('p5-o3-rewind-resume-maws.json'));
  const hidden = { pre: ['T2', 'T3'], 'pre-files': ['T2', 'T3'], post: ['T3', 'T4'], 'pre-release': ['T2'], 'same-release': ['T2'] };
  for (const [arm, turns] of Object.entries(hidden)) {
    const last = maws[arm].live.at(-1).after;
    assert.deepEqual(last.hiddenTurns, turns, arm);
    assert.deepEqual(last.twice, [], arm);
    for (const d of maws[arm].disk.filter((d) => /after-rewind|after-release|end/.test(d.snapshot) && d.follower.rewinds.length)) assert.deepEqual(d.follower.hiddenTurns, turns, `${arm} ${d.snapshot}`);
  }
  const preview = (arm, label) => maws[arm].disk.find((d) => d.snapshot.includes(label)).recentTurns;
  assert.ok(preview('pre-release', 'after-release').some((t) => t.includes('PROMPT_T2')));
  assert.ok(!preview('same-release', 'after-release').some((t) => t.includes('PROMPT_T2')));
});
