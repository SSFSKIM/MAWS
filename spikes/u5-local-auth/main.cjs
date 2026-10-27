// U5's spike (P5-O10 M9, docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md; the remote layer's §12 unknown 1): which
// confirmation can gate a step-up signature in MAWS's unsigned dev build. It runs under this repository's own Electron
// (node_modules/electron, what `pnpm dev` runs) and tries the three candidates in the spec's order of preference:
//
//   1. Electron's systemPreferences.promptTouchID (LAContext evaluateAccessControl, kSecAccessControlUserPresence)
//   2. the LAContext addon (local-auth.m) with LAPolicyDeviceOwnerAuthentication (Touch ID, Watch or the password)
//   3. an app-level confirmation (dialog.showMessageBox), no OS authentication: RL §5.1's weaker device
//
// Each OS candidate is asked three times (approve with Touch ID, approve with the password, cancel) and the app-level
// one twice (confirm, cancel). The window says what to do at each step, and so does each prompt's own reason. Every
// outcome, with the environment, is written to results/<host>-<time>.json. Start it with ./run.sh, never directly: the
// script builds the addon first. Options: --only 1,3 runs only those candidates; --step-timeout-ms N (default 120000).
'use strict';
const { app, BrowserWindow, dialog, systemPreferences } = require('electron');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HERE = __dirname;
const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const only = (option('--only') ?? '1,2,3').split(',').map(Number);
const STEP_TIMEOUT_MS = Number(option('--step-timeout-ms') ?? 120_000);

// A scratch profile, so the spike writes nothing under ~/Library/Application Support (not MAWS's, not Electron's).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'maws-u5-'));
app.setPath('userData', path.join(scratch, 'userData'));
app.setPath('sessionData', path.join(scratch, 'sessionData'));

// What a step-up would show (src/main/device/step-up.ts's renderAction): the summary goes in a system prompt's reason,
// the text in the app's own view. The reason ends with a marker, so the record says whether a long reason is cut.
const SAMPLE = {
  summary: 'sminos.spawn on machine mref-mini-0000001',
  text: ['Action: sminos.spawn', 'Machine: mref-mini-0000001', 'Org: org-staging', 'Device: dev-macbook', 'brief: "fix the failing tests in src/main/device and open a PR"', 'checkout: "/Users/owner/Developer/GitHub/MAWS"', 'permission_mode: "default"'].join('\n'),
};
const LONG_TAIL = `This is what a step-up asks: ${SAMPLE.summary}, checkout /Users/owner/Developer/GitHub/MAWS, permission mode default, brief "fix the failing tests in src/main/device and open a PR". [END OF REASON]`;

const record = {
  spike: 'u5-local-auth',
  startedAt: new Date().toISOString(),
  environment: environment(),
  candidates: [],
};

function environment() {
  const run = (file, args) => {
    try {
      return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      return `${file} failed: ${String(error.stderr ?? error.message).trim()}`;
    }
  };
  // `codesign -dv` writes to stderr; it says how the binary that asks is signed (what "unsigned build" meant here).
  const signed = spawnSync('codesign', ['-dv', process.execPath], { encoding: 'utf8' });
  const codesign = `${signed.stdout ?? ''}${signed.stderr ?? ''}`.trim();
  return {
    host: os.hostname(),
    model: run('sysctl', ['-n', 'hw.model']),
    macos: run('sw_vers', ['-productVersion']),
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    execPath: process.execPath,
    codesign,
    appName: app.getName(),
  };
}

let win;
async function show(heading, body) {
  console.log(`\n== ${heading}\n${body}`);
  if (!win || win.isDestroyed()) return;
  const html = `<h2>${escape(heading)}</h2><pre>${escape(body)}</pre>`;
  await win.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(html)}`);
}
const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** One prompt, bounded: an answer, an error, or no answer within STEP_TIMEOUT_MS (the prompt may stay on screen). */
async function step(candidate, name, expect, instruction, ask) {
  await show(`Candidate ${candidate.number}: ${candidate.name} — ${name}`, `${instruction}\n\nExpected outcome: ${expect}`);
  const started = Date.now();
  let timer;
  const outcome = await Promise.race([
    ask().then(
      (value) => ({ answered: true, ...value }),
      (error) => ({ answered: true, ok: false, error: String(error && error.message ? error.message : error) }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ answered: false, ok: false, error: `no answer in ${STEP_TIMEOUT_MS} ms` }), STEP_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  const entry = { step: name, expect, ms: Date.now() - started, ...outcome };
  candidate.steps.push(entry);
  console.log(JSON.stringify(entry));
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function touchId(candidate) {
  candidate.canPromptTouchID = systemPreferences.canPromptTouchID();
  const ask = (reason) => () => systemPreferences.promptTouchID(reason).then(() => ({ ok: true }));
  await step(candidate, 'approve-touch-id', 'resolved', 'A system prompt opens. Approve it with Touch ID.\nNote whether the prompt shows "[END OF REASON]".', ask(`U5 1/3 step 1 — APPROVE with Touch ID. ${LONG_TAIL}`));
  await step(candidate, 'approve-password', 'resolved', 'A system prompt opens. Do NOT touch the sensor: choose "Use Password…" if it is offered and enter your login password.\nIf no password option is offered, press Cancel and note that.', ask('U5 1/3 step 2 — choose "Use Password…" and enter your password (do not use Touch ID)'));
  await step(candidate, 'cancel', 'rejected', 'A system prompt opens. Press Cancel.', ask('U5 1/3 step 3 — press Cancel'));
}

async function addon(candidate) {
  let localAuth;
  try {
    localAuth = require(path.join(HERE, 'build', 'local-auth.node'));
  } catch (error) {
    candidate.loadError = String(error.message);
    await show('Candidate 2: the LAContext addon', `It did not load: ${candidate.loadError}\nSkipping it.`);
    return;
  }
  candidate.addonVersion = localAuth.version;
  candidate.canEvaluate = localAuth.canEvaluate();
  const ask = (reason) => () => localAuth.evaluate(reason);
  await step(candidate, 'approve-touch-id', 'ok: true', 'A system prompt opens. Approve it with Touch ID.\nNote whether the prompt shows "[END OF REASON]".', ask(`U5 2/3 step 1 — APPROVE with Touch ID. ${LONG_TAIL}`));
  await step(candidate, 'approve-password', 'ok: true', 'A system prompt opens. Do NOT touch the sensor: choose "Use Password…" and enter your login password.', ask('U5 2/3 step 2 — choose "Use Password…" and enter your password (do not use Touch ID)'));
  await step(candidate, 'cancel', 'ok: false, code -2 (user cancel)', 'A system prompt opens. Press Cancel.', ask('U5 2/3 step 3 — press Cancel'));
}

async function appLevel(candidate) {
  const ask = () => () =>
    dialog
      .showMessageBox(win, { type: 'question', message: `Confirm: ${SAMPLE.summary}`, detail: SAMPLE.text, buttons: ['Confirm', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true })
      .then(({ response }) => ({ ok: response === 0 }));
  await step(candidate, 'confirm', 'ok: true', 'An app dialog (not a system one) opens. Press Confirm.', ask());
  await step(candidate, 'cancel', 'ok: false', 'An app dialog opens. Press Cancel.', ask());
}

const CANDIDATES = [
  { number: 1, name: 'systemPreferences.promptTouchID', run: touchId },
  { number: 2, name: 'the LAContext addon (deviceOwnerAuthentication)', run: addon },
  { number: 3, name: 'an app-level confirmation', run: appLevel },
];

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 720, height: 420, title: 'MAWS U5 spike', webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL('data:text/html;charset=utf-8,<body style="font:15px -apple-system;padding:20px"></body>');
  const chosen = CANDIDATES.filter((c) => only.includes(c.number));
  const count = chosen.reduce((n, c) => n + (c.number === 3 ? 2 : 3), 0);
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    message: 'U5: step-up confirmation spike',
    detail: `It will show ${count} prompts, one at a time: ${chosen.map((c) => `${c.number}. ${c.name}`).join('; ')}.\nThis window says what to do at each; so does each prompt's own text.`,
    buttons: ['Start', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    for (const c of chosen) {
      const candidate = { number: c.number, name: c.name, steps: [] };
      record.candidates.push(candidate);
      await c.run(candidate);
    }
  } else {
    record.quit = true;
  }
  record.finishedAt = new Date().toISOString();
  const dir = path.join(HERE, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.environment.host.replace(/[^A-Za-z0-9.-]/g, '_')}-${record.startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  await show('Done', `Results: ${file}\nNow fill in RECORD.md with what you saw.`);
  console.log(`\nresults: ${file}`);
  fs.rmSync(scratch, { recursive: true, force: true });
  setTimeout(() => app.quit(), 3000);
});

app.on('window-all-closed', () => {});
