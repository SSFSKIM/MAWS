// The parity bench's Desktop driver (P4-A1): the GUI half of one Desktop repetition, for `cua_repl` on the host where
// Claude Desktop runs, signed in to the owner's account. Written in the harness phase and NOT run there; the record
// run's GUI hold runs it (spikes/p4-parity-bench/findings.txt, "The record run"). Timing never comes from here: the
// parser reads Desktop's own engine records, so the driver's own latency drops out. Its only duties are to start a
// fresh session with the arm's controls, send the task's prompt verbatim, and wait for the turn to end.
//
// One repetition, by the agent holding the GUI:
//   1. Bash:     python3 -I spikes/p4-parity-bench/desktop-prep.py before <task> <rep> --out <run> [--surface code|cowork]
//                (lays the pristine doc.md and deck.html in the arm's folder and prints the exact prompt)
//   2. cua_repl: this file's text once per kernel (it defines globalThis.bench), then
//                await bench.rep({ surface: 'code', folder: '<printed folder>', prompt: '<printed prompt>' })
//   3. Bash:     python3 -I spikes/p4-parity-bench/desktop-prep.py after <task> <rep> --out <run>
//                (finds the session's records, copies the edited file, runs the checker, writes the manifest)
// Interleave with the MAWS arm per findings.txt's order; never run two repetitions at once.
//
// Every step observes, acts, then verifies; a step whose verification fails throws with the AX lines it saw, and the
// repetition is redone from step 1 (an aborted turn's records are excluded by desktop-prep's `startedAt` and by the
// checker). The labels are Desktop 2.42304's, read from its readable source (`~/claude-desktop-re/readable/
// app-2.42304.0/`, web/i18n/static/ko-KR.json for the Korean the owner's Desktop shows, `config.json` locale ko-KR);
// the first step of the hold checks each one against the live AX tree (`bench.probe()`) before any timed repetition,
// and amends LABELS here if Desktop has moved.

const LABELS = {
  // The Code tab and a new session in a folder
  codeTab: [/^\s*\d+\s+.*\b(tab|button|radio button)\b.*\b(Code|코드)\b/i],
  newSession: [/\b(New session|New Code session)\b/, /새 세션|새 Code 세션/],
  chooseFolder: [/Choose folder/, /폴더 선택/],
  // the composer's model pill (data-testid epitaxy-cds-model-selector) and its Effort submenu
  modelPill: [/\b(Opus|Sonnet|Haiku|Fable)\b.*\b\d/, /model selector|모델/i],
  modelOption: (model) => [new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
  effortMenu: [/\bEffort\b/, /노력/],
  effortOption: { xhigh: [/Extra high/, /매우 높음/], high: [/\bHigh\b/, /^\s*\d+\s+.*\b높음\b/], medium: [/\bMedium\b/, /중간/], low: [/\bLow\b/, /낮음/], max: [/\bMax\b/, /최대/] },
  permissionMode: [/Permission mode/, /권한 모드/],
  autoMode: [/^\s*\d+\s+.*\b(Auto)\b(?!.*accept)/, /^\s*\d+\s+.*\b자동\b/],
  // the prompt (data-testid code-prompt-input), Send (code-prompt-send, "Send"/"보내기"), Stop (code-prompt-stop, "Stop"/"중지")
  input: [/text (area|entry area|field)/i],
  send: [/\bbutton\b.*\b(Send|보내기)\b/],
  stop: [/\bbutton\b.*\b(Stop|중지)\b/],
  // a permission card that still appears in auto mode
  alwaysAllow: [/Always allow/, /항상 허용/],
  // the folder panel (NSOpenPanel)
  open: [/\bbutton\b.*\b(Open|열기|Choose|선택)\b/],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The AX tree's element lines: `<index> <role> <name…>`.
function elements(state) {
  return state
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ index: Number(m[1]), text: m[2], line: m[0] }));
}

function find(state, patterns) {
  for (const pattern of patterns) {
    const hit = elements(state).find((e) => pattern.test(e.line));
    if (hit) return hit;
  }
  return null;
}

async function fresh(app) {
  return app.getAXState({ emit: false, disableDiffing: true });
}

// Click the first element matching `patterns`, then verify with `until` (a predicate over the new state) within `ms`.
async function clickAndVerify(app, name, patterns, until, ms = 10_000) {
  const state = await fresh(app);
  const hit = find(state, patterns);
  if (!hit) throw new Error(`${name}: no element matched ${patterns.map(String).join(' or ')}; the tree's first lines:\n${state.split('\n').slice(0, 80).join('\n')}`);
  await app.click(hit.index);
  const deadline = Date.now() + ms;
  for (;;) {
    const after = await fresh(app);
    if (!until || until(after)) return after;
    if (Date.now() > deadline) throw new Error(`${name}: clicked [${hit.index}] ${hit.text} but the expected state did not appear within ${ms} ms`);
    await sleep(300);
  }
}

const has = (patterns) => (state) => find(state, patterns) !== null;
const lacks = (patterns) => (state) => find(state, patterns) === null;

async function app() {
  return cua.getApp('com.anthropic.claudefordesktop');
}

// A fresh Code session in `folder`, set to the arm's model, effort and auto mode.
async function newCodeSession(a, folder, { model = 'Opus 5.5', effort = 'xhigh' } = {}) {
  await clickAndVerify(a, 'the Code tab', LABELS.codeTab, has(LABELS.newSession));
  await clickAndVerify(a, 'New session', LABELS.newSession, has(LABELS.chooseFolder));
  // The folder: the native panel, the path typed through Go to Folder (⇧⌘G), then Open.
  await clickAndVerify(a, 'Choose folder', LABELS.chooseFolder, has(LABELS.open));
  await a.pressKey('cmd+shift+g');
  await sleep(500);
  await a.typeText(folder);
  await a.pressKey('Return');
  await sleep(800);
  const base = folder.split('/').filter(Boolean).at(-1);
  await clickAndVerify(a, 'Open the folder', LABELS.open, (s) => s.includes(base) && lacks(LABELS.open)(s));
  // Model and effort: the composer's pill, the model, then Effort › the level; verified on the pill's text.
  await clickAndVerify(a, 'the model pill', LABELS.modelPill, has(LABELS.modelOption(model)));
  await clickAndVerify(a, `the model ${model}`, LABELS.modelOption(model), null);
  await clickAndVerify(a, 'the model pill again', LABELS.modelPill, has(LABELS.effortMenu));
  await clickAndVerify(a, 'Effort', LABELS.effortMenu, has(LABELS.effortOption[effort]));
  await clickAndVerify(a, `effort ${effort}`, LABELS.effortOption[effort], null);
  // Auto mode, set on every session (the saved landing default is acceptEdits).
  await clickAndVerify(a, 'Permission mode', LABELS.permissionMode, has(LABELS.autoMode));
  await clickAndVerify(a, 'Auto', LABELS.autoMode, null);
}

// Type the prompt verbatim and send; verified by Stop appearing (the turn running).
async function send(a, prompt) {
  const state = await fresh(a);
  const input = find(state, LABELS.input);
  if (!input) throw new Error(`no prompt input in the tree:\n${state.split('\n').slice(0, 80).join('\n')}`);
  await a.click(input.index);
  await a.paste(prompt, { format: 'text' }); // paste, not typeText: the prompt arrives whole, its quotes unchanged
  const typed = await fresh(a);
  if (!typed.includes(prompt.slice(-30))) throw new Error('the prompt did not land in the input whole');
  await a.pressKey('Return');
  const deadline = Date.now() + 20_000;
  while (!has(LABELS.stop)(await fresh(a))) {
    if (Date.now() > deadline) throw new Error('Send did not start a turn (no Stop button within 20 s)');
    await sleep(250);
  }
}

// Wait for the turn to end: Stop gone for 3 s running. A permission card is answered Always allow and recorded,
// since the repetition then measured a human stop and desktop-prep marks it.
async function waitTurn(a, ms = 600_000) {
  const deadline = Date.now() + ms;
  let goneSince = null;
  const answered = [];
  for (;;) {
    const state = await fresh(a);
    const allow = find(state, LABELS.alwaysAllow);
    if (allow) {
      answered.push(allow.text);
      await a.click(allow.index);
    }
    goneSince = has(LABELS.stop)(state) ? null : (goneSince ?? Date.now());
    if (goneSince !== null && Date.now() - goneSince > 3_000) return { permissionsAnswered: answered };
    if (Date.now() > deadline) throw new Error('the turn did not end within 10 minutes');
    await sleep(500);
  }
}

globalThis.bench = {
  LABELS,
  // The hold's first step: the live tree's lines that each label matches, so a moved label is fixed before timing.
  async probe() {
    const a = await app();
    const state = await fresh(a);
    const report = {};
    for (const [key, patterns] of Object.entries(LABELS)) if (Array.isArray(patterns)) report[key] = find(state, patterns)?.line ?? null;
    nodeRepl.write(JSON.stringify(report, null, 2));
    return report;
  },
  // One timed repetition on a Code session. `surface: 'cowork'` follows the same send and wait inside a Cowork task
  // whose model and effort were set as the hold's first step found possible; its session setup is done by hand in the
  // hold (findings.txt), since its labels are not yet read.
  async rep({ surface = 'code', folder, prompt, model = 'Opus 5.5', effort = 'xhigh' }) {
    const a = await app();
    if (surface === 'code') await newCodeSession(a, folder, { model, effort });
    const sentAt = new Date().toISOString();
    await send(a, prompt);
    const result = await waitTurn(a);
    nodeRepl.write(JSON.stringify({ surface, sentAt, endedAt: new Date().toISOString(), ...result }));
    return result;
  },
  // The untimed follow-up of a Cowork deck repetition: the deck's files written to the folder for the checker.
  async writeDeckFiles(title) {
    const a = await app();
    await send(a, `Write the current files of the slide deck "${title}" into the folder bench-after/ exactly as they are now (project/deck.json and project/slides/<id>.html). Change nothing in the deck.`);
    return waitTurn(a);
  },
};
nodeRepl.write('bench driver loaded: bench.probe(), bench.rep({ surface, folder, prompt }), bench.writeDeckFiles(title)');
