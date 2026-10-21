// The parity bench's Desktop driver (P4-A1): the GUI half of one Desktop repetition, for `cua_repl` on the Mac mini,
// where Claude Desktop runs signed in to the owner's account (findings.txt §7a; `devices_use mini`). Timing never comes
// from here: the parser reads the engine's own records, so the driver's latency drops out. Its duties are to start a
// fresh session with the arm's controls, send the task's prompt verbatim, wait for the turn to end and, for a cloud
// Cowork session, have the session hand over its own transcript and download it on the mini.
//
// Desktop 3.1623.0 (read live in Part A, 2026-10-21) has two surfaces the bench uses:
//   code   the Code tab: a local Claude Code session on the mini in a folder (engine 2.1.304, records under the mini's
//          ~/.claude/projects). The documents' cells, and the decks' fallback (c), plain deck.html.
//   cowork the Claude tab: Cowork in Anthropic's cloud (CLAUDE_CODE_ENTRYPOINT=remote_cowork, a Linux VM, engine 2.1.305)
//          with the Slides deck kind (`Artifact`); the Mac mini is attached as a device. Its transcript lives in the VM
//          (/root/.claude/projects/-home-claude/<id>.jsonl) and reaches the mini only by the hand-over below.
//
// One repetition, by the agent holding the GUI:
//   1. Bash:     python3 -I spikes/p4-parity-bench/desktop-prep.py before <task> <rep> --out <run> [--surface code|cowork]
//                  [--seed next]   (a cloud deck of the record: its seed deck, named in the prompt by its url)
//   2. cua_repl: this file's text once per kernel (it defines globalThis.bench), then
//                await bench.rep({ surface: 'code', folder: '<printed folder>', prompt: '<printed prompt>' })
//                await bench.rep({ surface: 'cowork', prompt: '<printed prompt>' })   then   await bench.handOver()
//                (rep's permissionsAnswered counts the permission cards it had to answer)
//   3. Bash:     python3 -I spikes/p4-parity-bench/desktop-prep.py after <task> <rep> --out <run>
//                  --permissions-answered <step 2's permissionsAnswered> [--transcript newest]   (a Cowork turn: its hand-over)
// A Cowork seed: bench.rep({ surface: 'cowork', prompt: <desktop-prep.py seed-prompt> }), bench.handOver(), then
// desktop-prep.py seed-add newest --out <run>.
//
// Every step observes, acts, then verifies; a step whose verification fails throws with the lines it saw, and the
// repetition is redone from step 1. The labels are 3.1623.0's Korean UI (the owner's Desktop runs ko-KR, input source
// ABC), with English beside them; `bench.probe()` reports which of them the live tree shows.

const L = {
  modeCode: [/라디오 버튼 Description: Code/],
  modeClaude: [/라디오 버튼 Description: Claude/],
  newSession: [/버튼 새로 생성/, /button New/],
  folderPopup: [/팝업 버튼 Description: 폴더:/],
  openFolder: [/^\s*\d+\s+폴더 열기…/, /Open folder…/],
  panelPath: [/텍스트 필드 \(settable\).*ID: PathTextField/],
  panelOpen: [/버튼 열기, ID: OKButton/, /button Open, ID: OKButton/],
  trust: [/버튼 작업 공간 신뢰/, /button Trust workspace/],
  permissionAuto: [/팝업 버튼 (권한: )?자동$/, /popup button (Permission: )?Auto$/],
  permissionPopup: [/팝업 버튼 (권한: )?(자동|수동|편집 수락|계획)/],
  permissionAutoItem: [/^\s*\d+\s+자동( |,|$)/],
  modelPopup: [/팝업 버튼 모델:/],
  modelOpusExtra: [/팝업 버튼 모델: Opus 5\.5 엑스트라/],
  modelOpusItem: [/^\s*\d+\s+Opus 5\.5( |,)/],
  effortItem: [/^\s*\d+\s+노력 /],
  effortExtraItem: [/^\s*\d+\s+엑스트라, Value/],
  promptCode: [/텍스트 엔트리 영역 \(settable\) Description: 프롬프트/],
  promptCloud: [/텍스트 엔트리 영역 \(settable\)( Description: Claude에게 프롬프트를 입력하세요\.)?/],
  sendCode: [/버튼 보내기$/],
  sendCloud: [/버튼 메시지 보내기$/],
  stop: [/버튼 (응답 )?중지$/, /button Stop$/],
  alwaysAllow: [/버튼 항상 허용/, /button Always allow/],
  download: [/버튼 다운로드/, /button Download/],
  save: [/버튼 저장, ID: OKButton/, /button Save, ID: OKButton/],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = (state) => state.split('\n');
function find(state, patterns, after = -1) {
  for (const p of patterns) {
    for (const line of lines(state)) {
      const m = /^\s*(\d+)\s/.exec(line);
      if (m && Number(m[1]) > after && p.test(line)) return { index: Number(m[1]), line: line.trim() };
    }
  }
  return null;
}
const has = (patterns) => (s) => find(s, patterns) !== null;
const lacks = (patterns) => (s) => find(s, patterns) === null;
const tree = (a) => a.getAXState({ emit: false, disableDiffing: true });

async function app() {
  return cua.getApp('com.anthropic.claudefordesktop');
}

// Click the first element matching `patterns`, then wait up to `ms` for `until` (a predicate over the new tree).
async function clickUntil(a, name, patterns, until, ms = 10_000) {
  const before = await tree(a);
  const hit = find(before, patterns);
  if (!hit) throw new Error(`${name}: nothing matched ${patterns.map(String).join(' or ')}\n${lines(before).slice(0, 60).join('\n')}`);
  await a.click(hit.index);
  const deadline = Date.now() + ms;
  for (;;) {
    const s = await tree(a);
    if (!until || until(s)) return s;
    if (Date.now() > deadline) throw new Error(`${name}: clicked [${hit.index}] ${hit.line} and the expected state did not come within ${ms} ms`);
    await sleep(300);
  }
}

// The model at Opus 5.5 with effort Extra, checked on the pop-up's own text; the effort submenu opens with Right.
async function opusExtra(a) {
  if (has(L.modelOpusExtra)(await tree(a))) return;
  await clickUntil(a, 'the model pop-up', L.modelPopup, has(L.modelOpusItem));
  await clickUntil(a, 'Opus 5.5', L.modelOpusItem, null);
  if (has(L.modelOpusExtra)(await tree(a))) return;
  await clickUntil(a, 'the model pop-up again', L.modelPopup, has(L.effortItem));
  await clickUntil(a, 'effort', L.effortItem, null);
  await a.pressKey('Right');
  await clickUntil(a, 'Extra', L.effortExtraItem, null);
  if (!has(L.modelOpusExtra)(await tree(a))) throw new Error('the model pop-up does not read Opus 5.5 엑스트라 after setting it');
}

// The permission mode at Auto, checked on the pop-up's own text.
async function auto(a) {
  if (has(L.permissionAuto)(await tree(a))) return;
  await clickUntil(a, 'the permission pop-up', L.permissionPopup, has(L.permissionAutoItem));
  await clickUntil(a, 'Auto', L.permissionAutoItem, has(L.permissionAuto));
}

// A fresh Code session in `folder`: the Code tab, New, the folder through the system panel (⇧⌘G, the path, Open), the
// workspace trusted once, then Auto and Opus 5.5 at Extra.
async function newCodeSession(a, folder) {
  await clickUntil(a, 'the Code tab', L.modeCode, has(L.newSession));
  await clickUntil(a, 'New', L.newSession, has(L.folderPopup));
  const current = find(await tree(a), L.folderPopup);
  if (!current.line.includes(folder)) {
    await clickUntil(a, 'the folder pop-up', L.folderPopup, has(L.openFolder));
    await clickUntil(a, 'Open folder…', L.openFolder, has(L.panelOpen));
    await a.pressKey('super+shift+g');
    let s = await tree(a);
    const path = find(s, L.panelPath);
    if (!path) throw new Error('the Go to Folder field did not open');
    await a.setValue(path.index, folder);
    await a.pressKey('Return');
    await clickUntil(a, 'Open', L.panelOpen, lacks(L.panelOpen));
    s = await tree(a);
    if (has(L.trust)(s)) await clickUntil(a, 'Trust workspace', L.trust, lacks(L.trust));
    const now = find(await tree(a), L.folderPopup);
    if (!now || !now.line.includes(folder.replace(/^\/tmp\//, '/private/tmp/')) && !now.line.includes(folder)) throw new Error(`the folder pop-up reads ${now && now.line}`);
  }
  await auto(a);
  await opusExtra(a);
}

// A fresh cloud Cowork session: the Claude tab, New, Auto and Opus 5.5 at Extra.
async function newCloudSession(a) {
  await clickUntil(a, 'the Claude tab', L.modeClaude, has(L.newSession));
  await clickUntil(a, 'New', L.newSession, has(L.promptCloud));
  await auto(a);
  await opusExtra(a);
}

// The prompt pasted whole (its quotes unchanged), checked in the field, then sent; verified by Stop appearing.
async function send(a, surface, prompt) {
  const s = await tree(a);
  const field = find(s, surface === 'code' ? L.promptCode : L.promptCloud);
  if (!field) throw new Error('no prompt field');
  await a.click(field.index);
  await a.paste(prompt, { format: 'text' });
  const typed = await tree(a);
  if (!typed.includes(prompt.slice(-40)) && !typed.includes(prompt.split('\n')[0].slice(0, 60))) throw new Error('the prompt did not land in the field whole');
  await clickUntil(a, 'Send', surface === 'code' ? L.sendCode : L.sendCloud, has(L.stop), 30_000);
}

// The turn's end: Stop gone for 3 s. A permission card is answered Always allow and counted (a human stop).
async function waitTurn(a, ms = 600_000) {
  const deadline = Date.now() + ms;
  let goneSince = null;
  const answered = [];
  for (;;) {
    const s = await tree(a);
    const allow = find(s, L.alwaysAllow);
    if (allow) {
      answered.push(allow.line);
      await a.click(allow.index);
    }
    goneSince = has(L.stop)(s) ? null : (goneSince ?? Date.now());
    if (goneSince !== null && Date.now() - goneSince > 3_000) return { permissionsAnswered: answered.length, permissionCards: answered };
    if (Date.now() > deadline) throw new Error('the turn did not end within 10 minutes');
    await sleep(500);
  }
}

// The untimed hand-over that follows a cloud turn in the same session: the session sends its own transcript file, and
// the file's card is downloaded on the mini (~/Downloads, the operator moves it with desktop-prep's --transcript).
// Its records come after the timed turn's, so the parser's turn window leaves them out.
const HAND_OVER = 'Send me this session\'s own transcript file with SendUserFile: the most recently modified .jsonl file under ~/.claude/projects/. Make no other change and call no other tool except to find that file.';
async function handOver(ms = 120_000) {
  const a = await app();
  await send(a, 'cowork', HAND_OVER);
  const turn = await waitTurn(a);
  const s = await tree(a);
  const card = find(s, L.download);
  if (!card) return { ...turn, downloaded: false, note: 'no download button in the tree: download the file card by hand and say so', lines: lines(s).filter((l) => /jsonl|다운로드|Download|파일/.test(l)).slice(-12) };
  await a.click(card.index);
  const deadline = Date.now() + ms;
  for (;;) {
    const t = await tree(a);
    const save = find(t, L.save);
    if (save) {
      await a.click(save.index);
      return { ...turn, downloaded: true, via: 'save panel' };
    }
    if (Date.now() > deadline || lacks(L.download)(t)) return { ...turn, downloaded: true, via: 'direct' };
    await sleep(500);
  }
}

globalThis.bench = {
  L,
  // What the live tree shows of each label (the hold's first step, and whenever a step throws).
  async probe() {
    const s = await tree(await app());
    const report = {};
    for (const [key, patterns] of Object.entries(L)) report[key] = find(s, patterns)?.line ?? null;
    nodeRepl.write(JSON.stringify(report, null, 2));
    return report;
  },
  // One timed repetition: a fresh session on the surface, the prompt sent, the turn waited out.
  async rep({ surface, folder, prompt }) {
    const a = await app();
    if (surface === 'code') await newCodeSession(a, folder);
    else if (surface === 'cowork') await newCloudSession(a);
    else throw new Error(`surface is code or cowork, not ${surface}`);
    const sentAt = new Date().toISOString();
    await send(a, surface, prompt);
    const result = await waitTurn(a);
    nodeRepl.write(JSON.stringify({ surface, sentAt, endedAt: new Date().toISOString(), ...result }));
    return result;
  },
  handOver,
};
nodeRepl.write('bench driver loaded (Desktop 3.1623.0): bench.probe(), bench.rep({ surface: "code"|"cowork", folder, prompt }), bench.handOver()');
