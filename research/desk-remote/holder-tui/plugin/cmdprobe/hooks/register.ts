import type { Register, EngineInterface } from 'claude-code'

// Probe mod: a file bus under CMDPROBE_BUS (default /private/tmp/cmd-probe/bus).
// Each <id>.req.json is picked up by a timer, acknowledged with <id>.ack.json,
// handled, and answered with <id>.res.json { ok, value | error, t0, t1 }.
// Turn and session events are logged to events/<ms>-<rand>.json.

type Req = { op: string; command?: string; args?: string; text?: string; source?: string;
  server?: string; tool?: string; input?: Record<string, unknown> }

let bus = '/private/tmp/holder-tui/main/bus'
const seen = new Set<string>()
let polling = false
let busy = false

function stamp() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

async function log($: EngineInterface, rec: Record<string, unknown>) {
  await $.fs.write(`${bus}/events/${stamp()}.json`, JSON.stringify({ t: Date.now(), ...rec })).catch(() => undefined)
}

  async function handle($: EngineInterface, id: string, req: Req) {
    const t0 = Date.now()
    const out = (o: Record<string, unknown>) =>
      $.fs.write(`${bus}/${id}.res.json`, JSON.stringify({ id, req, t0, t1: Date.now(), ...o }))
    try {
      let value: unknown
      switch (req.op) {
        case 'run':
          value = await $.command.run({ command: req.command ?? '', ...(req.args !== undefined ? { args: req.args } : {}) })
          break
        case 'env': value = { sentinel: await $.env.get('HOLDER_SENTINEL'), bus: await $.env.get('CMDPROBE_BUS'), kind: await $.env.get('CLAUDE_CODE_SESSION_KIND'), editor: await $.env.get('EDITOR'), home: await $.env.get('HOME'), term: await $.env.get('TERM'), tmux: await $.env.get('TMUX'), custom: await $.env.get('HOLDER_SECOND') }; break
        case 'model': value = await $.session.model(); break
        case 'id': value = await $.session.id(); break
        case 'list': value = await $.command.list(); break
        case 'tools': value = (await $.tool.list()).map((t) => t.name); break
        case 'config': value = await $.config.list(); break
        case 'settings': value = req.source ? await $.settings.read({ source: req.source as never }) : await $.settings.read(); break
        case 'usage': value = await $.session.usage(); break
        case 'root': value = { cwd: await $.session.cwd(), root: await $.session.root() }; break
        case 'turns': value = await $.session.turns(); break
        case 'messages': {
          const m = await $.session.messages()
          value = { n: m.length, tail: m.slice(-6).map((x) => ({ role: x.role, text: (x.text ?? '').slice(0, 160) })) }
          break
        }
        case 'submit': value = await $.prompt.submit({ text: req.text ?? '' }); break
        case 'check': value = await $.tool.check({ tool: req.tool ?? '', input: req.input ?? {} } as never); break
        case 'mcpcall': value = await $.mcp.call(req.server ?? '', req.tool ?? '', req.input ?? {}); break
        default: throw new Error(`unknown op ${req.op}`)
      }
      await out({ ok: true, value: value === undefined ? '__undefined__' : value })
    } catch (err) {
      await out({ ok: false, error: String((err as Error)?.message ?? err) })
    }
  }

  async function poll($: EngineInterface) {
    if (busy) return
    busy = true
    try {
      const names = (await $.fs.list(bus)).map((f) => f.name).filter((n) => n.endsWith('.req.json'))
      for (const name of names.sort()) {
        const id = name.slice(0, -'.req.json'.length)
        if (seen.has(id)) continue
        seen.add(id)
        if (await $.fs.exists(`${bus}/${id}.ack.json`)) continue
        const req = JSON.parse(await $.fs.read(`${bus}/${name}`)) as Req
        await $.fs.write(`${bus}/${id}.ack.json`, JSON.stringify({ t: Date.now() }))
        void handle($, id, req)
      }
    } catch (err) {
      await log($, { ev: 'poll-error', error: String((err as Error)?.message ?? err) })
    } finally {
      busy = false
    }
  }

export const register: Register = (on) => {
  on('command.run', async ($, e, next) => {
    await log($, { ev: 'command.before', command: e.command, args: e.args, id: await $.session.id() })
    const value = await next(e)
    await log($, { ev: 'command.after', command: e.command, id: await $.session.id() })
    return value
  })
  on('session.attach', async ($, e, next) => { await log($, { ev: 'session.attach', id: await $.session.id(), event: e }); return next(e) })
  on('session.detach', async ($, e, next) => { await log($, { ev: 'session.detach', id: await $.session.id(), event: e }); return next(e) })
  on('session.start', async ($, e, next) => {
    bus = (await $.env.get('CMDPROBE_BUS')) ?? bus
    await log($, { ev: 'session.start', source: (e as { source?: string }).source, id: await $.session.id() })
    if (!polling) {
      polling = true
      $.clock.every(250, () => poll($))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await log($, { ev: 'session.end', reason: (e as { reason?: string }).reason })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await log($, { ev: 'turn.start', turnId: e.turnId })
    if (e.agentId === undefined && (await $.fs.exists(`${bus}/flag-turnheld`))) {
      try {
        const v = await $.command.run({ command: 'effort', args: 'low' })
        await log($, { ev: 'turnheld-run', ok: true, value: v })
      } catch (err) {
        await log($, { ev: 'turnheld-run', ok: false, error: String((err as Error)?.message ?? err) })
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (await $.fs.exists(`${bus}/flag-toolheld`)) {
      try {
        const v = await $.command.run({ command: 'effort', args: 'medium' })
        await log($, { ev: 'toolheld-run', ok: true, value: v })
      } catch (err) {
        await log($, { ev: 'toolheld-run', ok: false, error: String((err as Error)?.message ?? err) })
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await log($, { ev: 'turn.complete' })
    return r
  })
}
