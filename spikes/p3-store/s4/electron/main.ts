// S4 item 2, main: one hidden window (show:false, own userData under /tmp, no dock icon) running page.ts; the human's
// Korean 2-set typing replayed through CDP (Input.dispatchKeyEvent keyCode 229, Input.imeSetComposition,
// Input.insertText) while the agent's ops fire mid-composition at chosen steps; each run's checks and the page's
// event log written to s4/out/ime.json and a summary to s4/out/ime.txt. Throwaway spike code.
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { keystrokes, type Step } from './hangul'

const OUT = process.env.S4_OUT ?? join(__dirname, 'out')
const BASE = process.env.S4_BASE ?? '/tmp/p3-s4/electron'
mkdirSync(BASE, { recursive: true }); mkdirSync(OUT, { recursive: true })
app.setPath('userData', join(BASE, 'user-data'))
app.dock?.hide()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const PAGE = process.env.S4_PAGE ?? '14' // '13': the v13 comparison page
const HOLD = process.env.S4_HOLD !== '0' // the editor's provider holds remote frames while composing
const FOLLOW = process.env.S4_FOLLOW !== '0' // the caret follows its block's id across a remote re-insert (v14 page)
const TAG = (PAGE === '13' ? '-v13' : '') + (HOLD ? '' : '-nohold') + (FOLLOW ? '' : '-nofollow')

const TYPED = ' 안녕하세요 한글 입력'
const P3 = 'A plain paragraph the human types into. Words to keep.'
type Timing = 'at-start' | 'mid' | 'before-end'
interface Scenario {
  name: string, ops: any[], live?: 'awareness' | 'none', expectP3: string | null, extra?: (st: any) => [string, boolean, string?][], backspace?: string[]
  /** the agent's awareness (caret in p3, editing blocks) moves at every compose step */
  pings?: boolean
  /** hold the composition open this long after the op (forces the provider's 5 s cap mid-composition) */
  stall?: number
  timings?: Timing[]
}

const scenarios: Scenario[] = [
  { name: 'replace_text earlier in the same paragraph', ops: [{ op: 'replace_text', block: 'p3', old: 'A plain paragraph', new: 'A simple paragraph' }], expectP3: P3.replace('plain', 'simple') + TYPED },
  { name: 'replace_block of the next block', ops: [{ op: 'replace_block', id: 'l1', markdown: '- first item, edited by the agent\n- second item with **bold**' }], expectP3: P3 + TYPED, extra: st => [['next block rewritten', st.editorMd.includes('- first item, edited by the agent ^l1') || /- first item, edited by the agent\n- second item with \*\*bold\*\*\n\^l1/.test(st.editorMd)]] },
  { name: 'insert before the block', ops: [{ op: 'insert', before: 'p3', markdown: 'An agent paragraph inserted above.' }], expectP3: P3 + TYPED, extra: st => [['inserted above p3', /An agent paragraph inserted above\. \^\w+\n\nA plain paragraph/.test(st.editorMd)]] },
  { name: 'move of the block being composed in (live caret from awareness)', ops: [{ op: 'move', id: 'p3', after: 'c1' }], live: 'awareness', expectP3: P3 + TYPED, extra: st => [['p3 now after c1', /\^c1\n\nA plain paragraph/.test(st.editorMd)]] },
  { name: 'move of the block being composed in (no awareness: p3 re-inserted)', ops: [{ op: 'move', id: 'p3', after: 'c1' }], live: 'none', expectP3: P3 + TYPED, extra: st => [['p3 now after c1', /\^c1\n\nA plain paragraph/.test(st.editorMd)]] },
  { name: 'control: no agent op', ops: [], expectP3: P3 + TYPED },
  { name: 'control: no agent op, Backspace inside a composition', ops: [], expectP3: P3 + TYPED, backspace: ['녕'] },
  { name: 'replace_text just before the caret in the same paragraph', ops: [{ op: 'replace_text', block: 'p3', old: 'Words to keep.', new: 'Words we keep.' }], expectP3: P3.replace('to keep', 'we keep') + TYPED },
  { name: 'replace_text in the same paragraph, Backspace inside a composition', ops: [{ op: 'replace_text', block: 'p3', old: 'Words to keep.', new: 'Words we keep.' }], expectP3: P3.replace('to keep', 'we keep') + TYPED, backspace: ['녕'] },
  { name: 'agent awareness only: its caret and editing blocks move inside the composing paragraph at every step', ops: [], pings: true, expectP3: P3 + TYPED },
  { name: 'replace_text just before the caret, with agent awareness moving at every step', ops: [{ op: 'replace_text', block: 'p3', old: 'Words to keep.', new: 'Words we keep.' }], pings: true, expectP3: P3.replace('to keep', 'we keep') + TYPED },
  { name: 'forced cap: a composition held open 5.6 s after the op (observed, not judged)', ops: [{ op: 'replace_text', block: 'p3', old: 'Words to keep.', new: 'Words we keep.' }], stall: 5600, expectP3: null, timings: ['mid'] }
]

const pickIndex = (steps: Step[], timing: Timing): number => {
  // around the middle of the text: the 4th syllable onwards
  const commits = steps.map((s, i) => (s.kind === 'commit' ? i : -1)).filter(i => i >= 0)
  const c = commits[Math.min(3, commits.length - 1)]
  if (timing === 'before-end') return c // fire before this commit
  // at-start: right after the compose that follows commit c (compositionstart of the next syllable)
  const next = steps.findIndex((s, i) => i > c && s.kind === 'compose')
  if (timing === 'at-start') return next + 1
  // mid: after the second compose of that syllable
  const second = steps.findIndex((s, i) => i > next && s.kind === 'compose')
  return second + 1
}

const run = async () => {
  await app.whenReady()
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: false } })
  await win.loadFile(join(__dirname, PAGE === '13' ? 'index13.html' : 'index.html'))
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  const cdp = (m: string, p: any = {}) => dbg.sendCommand(m, p)
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  const ev = async (js: string) => { const r: any = await cdp('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value }
  while (!(await ev('!!window.s4ready'))) await sleep(20)

  const doStep = async (s: Step) => {
    switch (s.kind) {
      case 'key': await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: s.key, code: s.code }); return
      case 'compose': await cdp('Input.imeSetComposition', { text: s.text, selectionStart: s.text.length, selectionEnd: s.text.length }); return
      case 'commit': await cdp('Input.insertText', { text: s.text }); return
      case 'plain': await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }); return
      case 'backspace': await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Backspace', code: 'Backspace' })
    }
  }

  const all: any[] = []
  const variants: Array<{ timing: Timing, pace: number, settle: number }> = []
  for (const timing of ['at-start', 'mid', 'before-end'] as Timing[]) for (const [pace, settle] of [[40, 20], [0, 0]]) variants.push({ timing, pace, settle })
  const only = process.env.S4_ONLY ? new RegExp(process.env.S4_ONLY) : null
  for (const sc of scenarios.filter(s => !only || only.test(s.name))) {
    if ((sc.pings || sc.stall) && (PAGE === '13' || !HOLD)) continue // the awareness and cap checks are about the v14 page's hold
    for (const v of variants.filter(x => !sc.timings || sc.timings.includes(x.timing))) {
      await ev(`window.s4.reset({ hold: ${HOLD}, follow: ${FOLLOW} })`)
      const c = await ev(`window.s4.caret('p3')`)
      await sleep(60) // the first key event can be dropped when sent right after focus (a harness race seen twice)
      const pingLog: any[] = []
      const steps = keystrokes(TYPED, { backspaceAfter: sc.backspace ?? [] })
      const fireAt = pickIndex(steps, v.timing)
      let agentOut: any = null
      for (let i = 0; i < steps.length; i++) {
        if (i === fireAt && sc.ops.length) {
          agentOut = await ev(`window.s4.agent(${JSON.stringify(sc.ops)}, { live: ${JSON.stringify(sc.live ?? 'awareness')} })`)
          if (v.settle) await sleep(v.settle)
          if (sc.stall) await sleep(sc.stall)
        }
        await doStep(steps[i])
        if (sc.pings && steps[i].kind === 'compose') pingLog.push(await ev(`window.s4.agentPing('p3', ${10 + (i % 30)})`))
        const s = steps[i]
        if (s.kind === 'key' && steps[i + 1]?.kind !== 'key') { /* keyup after the effect, like the capture */ }
        if (s.kind === 'compose' || s.kind === 'commit') {
          const prevKey = [...steps.slice(0, i)].reverse().find(x => x.kind === 'key') as any
          if (prevKey && (s.kind === 'compose')) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: prevKey.keyCode, key: prevKey.key, code: prevKey.code })
        }
        if (v.pace) await sleep(v.pace)
      }
      await sleep(80)
      await ev('window.s4.settle()')
      const st = await ev(`(() => { const s = window.s4.state(); s.p3 = s.text('p3'); delete s.text; return s })()`)
      const commits = steps.filter(s => s.kind === 'commit').map(s => (s as any).text)
      const ends = st.events.filter((e: any) => e.type === 'compositionend').map((e: any) => e.data)
      const h = st.hold ?? {}
      const holdChecks: [string, boolean, string?][] = HOLD
        ? [
            ['hold: every sync frame that arrived was applied, in order, none left buffered', h.arrived === h.syncApplied && h.outOfOrder === 0 && !h.holdingNow && h.heldNow === 0, `arrived ${h.arrived} applied ${h.syncApplied} outOfOrder ${h.outOfOrder}`],
            ['hold: acks kept arriving while held', h.acksDuringHold > 0, `acks during hold ${h.acksDuringHold} of ${h.acks}`],
            ...(sc.pings ? [['hold: the agent\'s awareness arrived while held and its caret rendered', h.awarenessDuringHold > 0 && pingLog.some(p => p.holding && p.composing) && pingLog.some(p => p.cursors > 0), `awareness during hold ${h.awarenessDuringHold}; pings while composing ${pingLog.filter(p => p.composing).length}; caret widgets ${Math.max(0, ...pingLog.map(p => p.cursors))}`]] as [string, boolean, string?][] : []),
            ...(sc.stall ? [] : [['hold: the 5 s cap never fired', h.capFired === 0, `capFired ${h.capFired}`]] as [string, boolean, string?][])
          ]
        : []
      const checks: [string, boolean, string?][] = [
        ...(sc.ops.length ? [['agent batch applied', !!agentOut?.res?.ok, JSON.stringify(agentOut?.res)?.slice(0, 300)], ['the op landed mid-composition', agentOut?.composing === true, `composing=${agentOut?.composing}`]] as [string, boolean, string?][] : []),
        ...(sc.expectP3 == null ? [] : [['composed Korean exactly as typed (p3 text)', st.p3 === sc.expectP3, JSON.stringify(st.p3)]] as [string, boolean, string?][]),
        ...holdChecks,
        ['DOM text equals the editor state (p3)', st.dom.p3 === st.pmText.p3, JSON.stringify(st.dom.p3)],
        ['editor state equals its Y doc', st.editorStateMatchesY],
        ['replicas converge (editor, host, agent)', st.converged],
        ['no duplicate ids; p3 keeps its id', st.dupes.length === 0 && st.ids.includes('p3'), st.dupes.join(',')],
        ...(sc.stall ? [] : [['one compositionend per commit, same data', JSON.stringify(ends) === JSON.stringify(commits), `${ends.length}/${commits.length} ${JSON.stringify(ends)}`]] as [string, boolean, string?][]),
        ['no page errors', st.errors.length === 0, st.errors.join('; ')],
        ...(sc.extra ? sc.extra(st) : [])
      ]
      const ok = checks.every(c => c[1])
      const holdNote = HOLD ? ` holds=${h.holds} flushes=${h.flushes} framesHeld=${h.framesHeld} maxHeldMs=${h.maxHeldMs} cap=${h.capFired}` : ''
      const line = `${ok ? 'PASS' : 'FAIL'} [${sc.name}] fire=${v.timing} pace=${v.pace}ms settle=${v.settle}ms live=${JSON.stringify(agentOut?.live)} composingAtOp=${agentOut?.composing}${holdNote}${sc.stall ? ` p3=${JSON.stringify(st.p3)} ends=${JSON.stringify(ends)}` : ''}`
      console.log(line)
      for (const c of checks) if (!c[1]) console.log(`   ✗ ${c[0]}: ${c[2] ?? ''}`)
      all.push({ scenario: sc.name, ...v, hold: HOLD, holdStats: st.hold, pings: pingLog, line, fireAt, steps: steps.length, ok, checks: checks.map(c => ({ name: c[0], ok: c[1], detail: c[2] })), caret: c, agent: agentOut, p3: st.p3, report: st.report, awareness: st.awareness, editorMd: ok ? undefined : st.editorMd, events: st.events })
    }
  }
  const pass = all.filter(r => r.ok).length
  writeFileSync(join(OUT, `ime${TAG}.json`), JSON.stringify(all, null, 1))
  const summary = `page v${PAGE}, composition hold (provider holds, binding drives, 5 s cap): ${HOLD}, caret follows id: ${FOLLOW && PAGE !== '13'}\n` + all.map(r => r.line + (r.ok ? '' : '\n' + r.checks.filter((c: any) => !c.ok).map((c: any) => `   ✗ ${c.name}: ${c.detail ?? ''}`).join('\n'))).join('\n')
  writeFileSync(join(OUT, `ime${TAG}.txt`), `${summary}\n\n${pass}/${all.length} runs passed\n`)
  console.log(`\n${pass}/${all.length} runs passed`)
  // one sample of the page's composition event log next to the capture's shape
  writeFileSync(join(OUT, `ime-events-sample${TAG}.txt`), all[0].events.map((e: any) => `${e.t} ${e.type}${e.inputType ? ' inputType=' + e.inputType : ''}${e.data != null ? ' data=' + JSON.stringify(e.data) : ''}${e.key ? ' key=' + JSON.stringify(e.key) + ' keyCode=' + e.code : ''}${e.composing != null ? ' isComposing=' + e.composing : ''}`).join('\n'))
  app.exit(0)
}
run().catch(e => { console.error(e); app.exit(1) })
