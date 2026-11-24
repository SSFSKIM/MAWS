// Question sheet C0 probe (docs/doperpowers/specs/2026-11-23-question-sheet-design.md, C0, pin ad4427f93, #865): a
// second plugin standing in for a secrets guard. Its tool.check denies a Read of any `.env`; its unmatched tool.call
// hook (the shape of devcloud's secrets guard) replaces the marker SECRET-VALUE-123 in a Read's result, and logs every
// call it sees with the origin, so the record shows whether a plugin's own $.tool.check / $.tool.call reaches it.
let dir
let n = 0
async function log($, tag, data) {
  n++
  try {
    if (!dir) dir = await $.env.get('QSP_DIR')
    if (dir) await $.fs.write(`${dir}/log/${String(Date.now())}-g${String(n).padStart(4, '0')}-guard-${tag}.json`, JSON.stringify({ tag, at: Date.now(), ...data }, null, 1))
  } catch {}
}
const scrub = (v) => (typeof v === 'string' ? v.split('SECRET-VALUE-123').join('[scrubbed-by-qsguard]') : v)
export const register = (on) => {
  on('tool.check', { tool: 'Read' }, async ($, e, next) => {
    const path = String(e.input?.file_path ?? '')
    const denied = /(^|\/)\.env$/.test(path)
    await log($, 'tool.check', { path, origin: next.origin, tool_use_id: e.tool_use_id, agentId: e.agentId, denied })
    if (denied) return { decision: 'deny', reason: 'QSGUARD: a secrets file' }
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    let scrubbed = false
    let out = r
    if (e.tool === 'Read' && r && r.result && r.result.file && typeof r.result.file.content === 'string' && r.result.file.content.includes('SECRET-VALUE-123')) {
      scrubbed = true
      out = { result: { ...r.result, file: { ...r.result.file, content: scrub(r.result.file.content) } }, context: r.context }
    }
    await log($, 'tool.call', { tool: e.tool, file_path: e.file_path, origin: next.origin, tool_use_id: e.tool_use_id, agentId: e.agentId, scrubbed, deny: r?.deny })
    return out
  })
}
