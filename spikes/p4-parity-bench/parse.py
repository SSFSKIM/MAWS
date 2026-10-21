#!/usr/bin/env python3
"""The parity bench's one parser (P4-A1; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2 and §5 P4-A1).

It reads both apps' engine records the same way: the Claude Code transcript every session writes
(`<config home>/projects/<slug>/<sessionId>.jsonl`; MAWS's sessions carry entrypoint `sdk-ts`, Claude Desktop's Code
sessions `claude-desktop`), so the driver's latency drops out. Where an arm has more, it adds detail without changing
what both arms share: MAWS's X8 journal (stream events with `ttft_ms`, block stops, `tools/call` to
`control_response`), ClaudeUsage's relay log (first byte, total, upstream gap per request), Cowork's `audit.jsonl`
(`result.ttft_ms`). Every figure says where it came from.

Definitions (stated here so the result cannot be argued after the run):
- A turn runs from a human `user` record to the next one, main thread only (sidechain records are subagents').
- The timed turn: the first human turn whose prompt carries the task's words (`promptMatch`). The human turns before it
  in its transcript are `priorTurns`; in a fresh session there are none.
- send: the human `user` record's timestamp (the engine's own clock, the host's in both apps).
- A request: the main-thread assistant records sharing an `api-request` id (`requestRef`), else an API `requestId`;
  sent at its `api-request` record's timestamp.
- send to first token: the journal's first main-thread `content_block_delta` after send; else Cowork's
  `result.ttft_ms`; else the transcript estimate (the first request's sent time plus its first-byte estimate).
- send to edit landed: the `tool_result` record of the turn's first successful landing call (the arm's edit tools:
  MAWS `artifact_edit` and `artifact_publish`; Desktop `Edit`, `Write`, `MultiEdit`, `Artifact`, Cowork's
  `update_artifact`; a manifest may name its own, the operations of a tool that also reads (`landingActions`) and the
  artifact's file names (`landingFiles`: a call counts only when its `file_path` or `path` names one of them)).
- send to turn end: the turn's last main-thread assistant record (the model's last block; Stop hooks after it are
  reported apart).
- Per request: first-byte wait (journal `ttft_ms`, else relay `firstByteSeconds`, else the transcript estimate: the
  first block's record time less the request's sent time less the first thinking block's `thinkingDurationMs`); server
  hold (journal: the last content block's stop to `message_delta` on a response that ends in a tool call; relay:
  response end less the first tool_use record; none from a transcript alone); generation (response end less sent, the
  first-byte wait and the hold; the transcript alone gives the last block's record as the end); tool execution (stream
  end to the last tool_result of the request; the journal adds MAWS's own `tools/call` to `control_response` span).
- The symmetric tool span both apps have: tool_use record to tool_result record (hold, permission check and execution).
- Cache state: the turn's first request reading at least half its context from cache is warm, else cold.
- Thinking where the request's type is not recorded (no `api-request` records): seen when a response carried a thinking
  block or thinking tokens; never read as a type.

Subcommands (run with `python3 -I`):
  turns  <transcript> [--journal J] [--relay LOG ...] [--all]   per-turn table (validation against the grounding)
  edit   <manifest.json>                                        one repetition as JSON
  report <run dir or manifest> ... [--json OUT] [--judge B5=cowork ...] [--maws B3=alwaysLoad ...]
                                                                per edit, per cell (medians and spread), the verdict

A manifest (one per repetition attempt; written by `e2e/bench-edit-live.spec.ts` for MAWS and `desktop-prep.py after`
for Desktop) is JSON: {arm: "maws"|"desktop", task: "B1"|"B3"|"B5"|"B7", rep, attempt, surface?: "code"|"cowork" (MAWS's
is "maws"), kind, host, transcript, journal?, relay?, audit?, landing?, landingActions?, landingFiles?, sessionId?,
promptMatch?, startedAt, load: {before: [1,5,15], after: [1,5,15]}, check: {pass, detail}, humanStop?: null | reason,
seedId?: string, seedCheck?: {pass, detail}, freshSession?: bool, pin: null | {model, effort}, measurementOnly: bool,
prompt, variant?: the MAWS arm's lever label (P4-A3), build?: its checkout's commit}. Relative paths resolve against the
manifest's directory. A cell is a task in an arm on a surface; a MAWS variant is a surface of its own, maws/<variant>. What makes
a repetition valid is `valid()`; what voids a verdict is VOIDING. The parser prints aggregates only, never message
content.
"""
import argparse
import glob
import json
import os
import random
import statistics
import sys
from datetime import datetime

THRESHOLD = 1.2  # §4.2, Decision Log 16.2: MAWS's median send-to-edit-landed above 1.2 x Desktop's means Desktop is faster
MIN_REPS = 5  # at least five repetitions per cell
TASKS = ('B1', 'B3', 'B5', 'B7')
DEFAULT_LANDING = (
    'mcp__maws__artifact_edit', 'mcp__maws__artifact_publish',
    'Edit', 'Write', 'MultiEdit', 'Artifact', 'mcp__cowork__update_artifact',
)


def ts(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() if s else None


def jsonl(path):
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def rnd(x, n=3):
    return None if x is None else round(x, n)


def short(name):
    return name.replace('mcp__maws__', '').replace('mcp__cowork__', 'cowork.').replace('mcp__plugin_', 'p.')


# ---- the transcript -------------------------------------------------------------------------------------------------

def is_human(r):
    """A human prompt: `turnOrigin: human` where the engine writes it (2.1.30x); else a main-thread user record whose
    content is a prompt, not a tool result, a meta or a compaction record."""
    if r.get('type') != 'user' or r.get('isSidechain'):
        return False
    if 'turnOrigin' in r:
        return r.get('turnOrigin') == 'human'
    if r.get('isMeta') or r.get('isCompactSummary') or r.get('toolUseResult') is not None:
        return False
    c = (r.get('message') or {}).get('content')
    if isinstance(c, str):
        return not c.startswith('<local-command') and not c.startswith('<command-')
    return isinstance(c, list) and any(b.get('type') == 'text' for b in c) and not any(b.get('type') == 'tool_result' for b in c)


def parse_transcript(path):
    recs = jsonl(path)
    meta = {'sessionId': next((r['sessionId'] for r in recs if r.get('sessionId')), None),
            'entrypoint': next((r['entrypoint'] for r in recs if r.get('entrypoint')), None),
            'version': next((r['version'] for r in recs if r.get('version')), None)}
    api = {r['id']: r for r in recs if r.get('type') == 'api-request' and r.get('id')}
    turns = []
    cur = None
    for r in recs:
        t = r.get('type')
        if is_human(r):
            cur = dict(idx=(r.get('turnPosition') or {}).get('turnIndex', len(turns) + 1), uuid=r.get('uuid'), send=ts(r['timestamp']),
                       sendIso=r['timestamp'], permissionMode=r.get('permissionMode'), promptChars=len(json.dumps((r.get('message') or {}).get('content'))),
                       prompt=(r.get('message') or {}).get('content'), asst=[], uses={}, results={}, stopHookEnd=None, stopHookMs=None, apiErrors=0)
            turns.append(cur)
            continue
        if cur is None or r.get('isSidechain'):
            continue
        if t == 'assistant' and (r.get('message') or {}).get('content') is not None:
            m = r['message']
            usage = m.get('usage') or {}
            rec = dict(t=ts(r['timestamp']), mid=m.get('id'), ref=r.get('requestRef'), rid=r.get('requestId'), usage=usage,
                       blocks=[b.get('type') for b in m.get('content', [])], thinkMs=r.get('thinkingDurationMs'), model=m.get('model'),
                       requestedModel=r.get('requestedModel'), effort=r.get('effort'), thinkingDisplay=r.get('thinkingDisplay'),
                       advisor=r.get('advisorModel'), iterTypes=[i.get('type') for i in usage.get('iterations') or [] if isinstance(i, dict) and i.get('type') != 'message'])
            cur['asst'].append(rec)
            for b in m.get('content', []):
                if b.get('type') == 'tool_use':
                    inp = b.get('input') if isinstance(b.get('input'), dict) else {}
                    path = inp.get('file_path') or inp.get('path')
                    cur['uses'][b['id']] = dict(id=b['id'], name=b['name'], t=rec['t'], key=rec['ref'] or rec['rid'] or rec['mid'], inChars=len(json.dumps(b.get('input', {}))),
                                                action=next((inp[k] for k in ('action', 'command', 'operation', 'type') if isinstance(inp.get(k), str)), None),
                                                file=os.path.basename(path) if isinstance(path, str) else None)
        elif t == 'user':
            c = (r.get('message') or {}).get('content')
            if isinstance(c, list):
                for b in c:
                    if b.get('type') == 'tool_result':
                        cur['results'][b['tool_use_id']] = dict(t=ts(r['timestamp']), err=bool(b.get('is_error')), chars=len(json.dumps(b.get('content'))))
        elif t == 'system' and r.get('subtype') == 'stop_hook_summary':
            cur['stopHookEnd'] = ts(r['timestamp'])
            cur['stopHookMs'] = max([h.get('durationMs') or 0 for h in r.get('hookInfos') or []] or [0])
        elif t == 'system' and r.get('subtype') == 'api_error':
            cur['apiErrors'] += 1
    return meta, api, turns


# ---- MAWS's X8 journal ----------------------------------------------------------------------------------------------

def journal_files(path):
    base = os.path.basename(path)
    if not base.endswith('.jsonl'):
        return [path]
    stem = base[:-len('.jsonl')]
    if stem.rsplit('.', 1)[-1].isdigit():
        return [path]
    d = os.path.dirname(path)
    rot = []
    for name in os.listdir(d):
        if name.startswith(stem + '.') and name.endswith('.jsonl'):
            n = name[len(stem) + 1:-len('.jsonl')]
            if n.isdigit():
                rot.append((int(n), os.path.join(d, name)))
    return [path] + [p for _, p in sorted(rot)]


def parse_journal(path):
    """Per API message (main thread): first byte, first delta, block stops, message_delta, stop; per tool_use id: MAWS's
    span from `tools/call` in to the `control_response` out; the spawn row's route."""
    rows = [r for p in journal_files(path) for r in jsonl(p)]
    msgs = {}
    order = []
    cur = None
    calls = {}
    spans = {}
    call_at = {}
    deltas = []
    route = None
    for row in rows:
        f = row.get('frame') if isinstance(row.get('frame'), dict) else {}
        at = ts(row.get('at'))
        if row['direction'] == 'meta' and f.get('event') == 'spawn':
            route = f.get('gateway')
        if row['direction'] == 'in' and f.get('type') == 'stream_event' and f.get('parent_tool_use_id') is None:
            e = f.get('event') or {}
            et = e.get('type')
            if et == 'message_start':
                mid = (e.get('message') or {}).get('id') or f.get('api_message_id')
                cur = msgs.setdefault(mid, dict(start=at, ttft=f.get('ttft_ms'), firstDelta=None, blocks={}, lastStop=None, toolUse=False, delta=None, stop=None))
                order.append(mid)
            elif cur is not None and et == 'content_block_start':
                cb = e.get('content_block') or {}
                cur['blocks'][e.get('index')] = cb.get('type')
                if cb.get('type') in ('tool_use', 'server_tool_use'):
                    cur['toolUse'] = True
            elif cur is not None and et == 'content_block_delta':
                if cur['firstDelta'] is None:
                    cur['firstDelta'] = at
                deltas.append(at)
            elif cur is not None and et == 'content_block_stop':
                cur['lastStop'] = at
            elif cur is not None and et == 'message_delta':
                cur['delta'] = at
            elif cur is not None and et == 'message_stop':
                cur['stop'] = at
                cur = None
        if row['direction'] == 'in' and f.get('type') == 'control_request' and (f.get('request') or {}).get('subtype') == 'mcp_message':
            m = (f['request'].get('message') or {})
            if m.get('method') == 'tools/call':
                tid = ((m.get('params') or {}).get('_meta') or {}).get('claudecode/toolUseId')
                calls[f.get('request_id')] = tid, at
                if tid:
                    call_at[tid] = at
        if row['direction'] == 'out' and f.get('type') == 'control_response':
            rid = (f.get('response') or {}).get('request_id')
            if rid in calls:
                tid, t0 = calls.pop(rid)
                if tid:
                    spans[tid] = at - t0
    return dict(msgs=msgs, spans=spans, callAt=call_at, deltas=sorted(deltas), route=route)


# ---- the relay ------------------------------------------------------------------------------------------------------

def parse_relay(paths, session_id):
    out = {}
    for p in paths:
        with open(p, encoding='utf-8') as f:
            for line in f:
                if session_id and session_id not in line:
                    continue
                o = json.loads(line)
                if o.get('session') == session_id and o.get('requestID') and 'totalSeconds' in o:
                    out[o['requestID']] = o
    return out


# ---- one turn -------------------------------------------------------------------------------------------------------

def measure(turn, api, journal=None, relay=None, audit=None, landing=DEFAULT_LANDING, landing_actions=None, landing_files=None):
    send = turn['send']
    reqs = {}
    order = []
    for a in turn['asst']:
        key = a['ref'] or a['rid'] or a['mid']
        if key not in reqs:
            reqs[key] = dict(key=key, ref=a['ref'], rid=a['rid'], mids=[], recs=[])
            order.append(key)
        reqs[key]['recs'].append(a)
        if a['mid'] and a['mid'] not in reqs[key]['mids']:
            reqs[key]['mids'].append(a['mid'])
    sources = set()
    rows = []
    prev_end = send
    for key in order:
        q = reqs[key]
        recs = q['recs']
        ar = api.get(q['ref']) if q['ref'] else None
        params = (ar or {}).get('params') or {}
        sent = ts(ar['timestamp']) if ar else None
        sent_src = 'api-request'
        if sent is None:  # no api-request record: the request went out right after the previous event
            sent, sent_src = prev_end, 'previous event'
        u = max((r['usage'] for r in recs), key=lambda x: x.get('output_tokens') or 0)
        ctx = (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0)
        first_rec = recs[0]['t']
        last_rec = recs[-1]['t']
        tools = [x for x in turn['uses'].values() if x['key'] == key]
        jm = None
        if journal:
            for mid in q['mids']:
                if mid in journal['msgs']:
                    jm = journal['msgs'][mid]
        ro = relay.get(q['rid']) if relay and q['rid'] else None
        # first byte
        fb, fb_src = None, None
        if jm and jm.get('ttft') is not None:
            fb, fb_src = jm['ttft'] / 1000, 'journal ttft_ms'
        elif ro:
            fb, fb_src = ro['firstByteSeconds'], 'relay'
        else:
            think = recs[0]['thinkMs'] if recs[0]['blocks'][:1] == ['thinking'] and recs[0]['thinkMs'] else 0
            fb, fb_src = max(0.0, first_rec - sent - think / 1000), 'transcript estimate'
        # response end and hold
        end, end_src = last_rec, 'last block record'
        hold, hold_src = None, None
        if jm and jm.get('stop'):
            # The engine writes `tools/call` as soon as the response's end reaches it and its stream events after, so the
            # stream's end is the earlier of the journal's message_delta and the request's first `tools/call`.
            called = [journal['callAt'][x['id']] for x in tools if x['id'] in journal['callAt']]
            end, end_src = min([jm['delta'] or jm['stop']] + called), 'journal stream end'
            if jm['toolUse'] and jm.get('lastStop'):
                hold, hold_src = max(0.0, end - jm['lastStop']), 'journal'
            elif not jm['toolUse']:
                hold, hold_src = 0.0, 'journal'
        elif ro and sent_src == 'api-request':
            end, end_src = sent + ro['totalSeconds'], 'relay total'
            if tools:
                hold, hold_src = max(0.0, end - tools[0]['t']), 'relay'
            else:
                hold, hold_src = 0.0, 'relay'
        gen = end - sent - fb - (hold or 0)
        ends = [turn['results'][x['id']]['t'] for x in tools if x['id'] in turn['results']]
        exe = max(0.0, max(ends) - end) if (tools and ends and end_src != 'last block record') else None
        maws_exec = [journal['spans'][x['id']] for x in tools if journal and x['id'] in journal['spans']]
        sources.update(s for s in (fb_src, end_src, hold_src) if s)
        rows.append(dict(sent=sent, sentSrc=sent_src, firstBlock=first_rec - sent, firstByte=fb, firstByteSrc=fb_src, end=end, endSrc=end_src,
                         hold=hold, holdSrc=hold_src, gen=gen, toolExec=exe, mawsExec=sum(maws_exec) if maws_exec else None,
                         ctx=ctx, cacheRead=u.get('cache_read_input_tokens') or 0, cacheWrite=u.get('cache_creation_input_tokens') or 0,
                         out=u.get('output_tokens') or 0, think=((u.get('output_tokens_details') or {}).get('thinking_tokens') or 0),
                         model=params.get('model') or recs[0]['model'], effort=(params.get('output_config') or {}).get('effort') or recs[0]['effort'],
                         thinking=(params.get('thinking') or {}).get('type'), requestedModel=recs[0]['requestedModel'],
                         thinkingBlocks=any(b in ('thinking', 'redacted_thinking') for r in recs for b in r['blocks']),
                         advisors=sorted({r['advisor'] for r in recs if r['advisor']}), iterationTypes=sorted({x for r in recs for x in r['iterTypes'] if x}),
                         serviceTier=u.get('service_tier'), speed=u.get('speed'), tools=[short(x['name']) for x in tools],
                         relayJoined=ro is not None, account=(ro or {}).get('account')))
        prev_end = max([last_rec] + ends)
    if not rows:
        return None
    # the landing call
    names = set(landing)
    landed = None
    landed_key = last_landed = None
    landing_calls = 0
    for x in sorted(turn['uses'].values(), key=lambda x: x['t']):
        if x['name'] not in names:
            continue
        if landing_actions and x['name'] in landing_actions and x['action'] not in landing_actions[x['name']]:
            continue
        if landing_files and x['file'] not in landing_files:  # an edit of another file is not the artifact's edit
            continue
        landing_calls += 1
        res = turn['results'].get(x['id'])
        if res and not res['err'] and landed is None:
            landed = dict(name=short(x['name']), at=res['t'], inChars=x['inChars'], span=res['t'] - x['t'], mawsExec=(journal or {}).get('spans', {}).get(x['id']))
            landed_key = x['key']
        if res and not res['err']:  # calls sorted by when they were made; a later one may land first
            last_landed = res['t'] if last_landed is None else max(last_landed, res['t'])
    # first token
    ft, ft_src = None, None
    if journal and journal['deltas']:
        after = [d for d in journal['deltas'] if d >= send]
        if after:
            ft, ft_src = after[0] - send, 'journal first delta'
    if ft is None and audit and audit.get('ttft_ms') is not None:
        ft, ft_src = audit['ttft_ms'] / 1000, 'audit result.ttft_ms'
    if ft is None:
        ft, ft_src = rows[0]['sent'] + rows[0]['firstByte'] - send, 'transcript estimate'
    last = turn['asst'][-1]['t']
    first_req = rows[0]
    warm = first_req['cacheRead'] >= 0.5 * max(1, first_req['ctx'])
    spans = []
    for x in sorted(turn['uses'].values(), key=lambda x: x['t']):
        res = turn['results'].get(x['id'])
        spans.append(dict(name=short(x['name']), span=rnd(res['t'] - x['t']) if res else None, err=res['err'] if res else None,
                          mawsExec=rnd((journal or {}).get('spans', {}).get(x['id']), 3), inChars=x['inChars'], resultChars=res['chars'] if res else None))
    wall = last - send
    tot = lambda k, rs=rows: sum(r[k] for r in rs if r[k] is not None)
    known = lambda k, rs=rows: all(r[k] is not None for r in rs)
    # P4-A3: the breakdown over the requests up to the one whose response made the landing call, the measure's own span
    # (findings §7c read B3's cause from it)
    upto = rows[:order.index(landed_key) + 1] if landed else None
    to_landing = upto and dict(requests=len(upto), firstByteWait=rnd(tot('firstByte', upto)), generation=rnd(tot('gen', upto)),
                               serverHold=rnd(tot('hold', upto)) if known('hold', upto) else None,
                               thinkingTokens=sum(r['think'] for r in upto), outputTokens=sum(r['out'] for r in upto))
    out = dict(
        turn=turn['idx'], sendAt=turn['sendIso'], permissionMode=turn['permissionMode'],
        sendToFirstToken=rnd(ft), firstTokenSrc=ft_src, sendToFirstBlock=rnd(turn['asst'][0]['t'] - send),
        sendToEditLanded=rnd(landed['at'] - send) if landed else None, landing=landed and {k: rnd(v, 3) if isinstance(v, float) else v for k, v in landed.items() if k != 'at'},
        landingCalls=landing_calls, sendToLastLanding=rnd(last_landed - send) if last_landed is not None else None, toLanding=to_landing, sendToTurnEnd=rnd(wall), stopHookMs=turn['stopHookMs'], apiErrors=turn['apiErrors'],
        requests=len(rows), contextFirst=first_req['ctx'], contextMax=max(r['ctx'] for r in rows),
        firstByteWait=rnd(tot('firstByte')), generation=rnd(tot('gen')), serverHold=rnd(tot('hold')) if known('hold') else None,
        toolExec=rnd(tot('toolExec')) if any(r['toolExec'] is not None for r in rows) else None,
        mawsExec=rnd(tot('mawsExec'), 3) if any(r['mawsExec'] is not None for r in rows) else None,
        toolSpanUnion=rnd(union([(x['t'], turn['results'][x['id']]['t']) for x in turn['uses'].values() if x['id'] in turn['results']])),
        outputTokens=sum(r['out'] for r in rows), thinkingTokens=sum(r['think'] for r in rows),
        cache=dict(state='warm' if warm else 'cold', firstRead=first_req['cacheRead'], firstWrite=first_req['cacheWrite'],
                   read=sum(r['cacheRead'] for r in rows), write=sum(r['cacheWrite'] for r in rows)),
        models=sorted({r['model'] for r in rows if r['model']}), requestedModels=sorted({r['requestedModel'] for r in rows if r['requestedModel']}),
        efforts=sorted({r['effort'] for r in rows if r['effort']}),
        thinking=sorted({r['thinking'] for r in rows if r['thinking']}),
        # Thinking as the records show it where the request's type is not recorded (a transcript without api-request records):
        # it ran when a response carried a thinking block or thinking tokens; nothing here says it was off.
        thinkingSeen='thinking blocks present' if any(r['thinkingBlocks'] for r in rows) else 'thinking tokens present' if any(r['think'] for r in rows) else None,
        advisorModels=sorted({a for r in rows for a in r['advisors']}), iterationTypes=sorted({x for r in rows for x in r['iterationTypes']}),
        serviceTiers=sorted({r['serviceTier'] for r in rows if r['serviceTier']}),
        speeds=sorted({r['speed'] for r in rows if r['speed']}), relayJoined=sum(1 for r in rows if r['relayJoined']),
        accounts=sorted({r['account'] for r in rows if r['account']}), sources=sorted(sources),
        perRequest=[{k: (rnd(v) if isinstance(v, float) and k != 'sent' and k != 'end' else v) for k, v in r.items() if k not in ('sent', 'end', 'account')} for r in rows],
        tools=spans,
    )
    return out


def union(iv):
    iv = sorted(iv)
    total = 0.0
    cur = None
    for a, b in iv:
        if cur is None or a > cur[1]:
            if cur:
                total += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        total += cur[1] - cur[0]
    return total


# ---- a repetition from its manifest ---------------------------------------------------------------------------------

def resolve(base, p):
    if p is None:
        return None
    p = os.path.expanduser(p)
    return p if os.path.isabs(p) else os.path.join(base, p)


def audit_result(path, session_id, since):
    """The `result` that closed the measured turn: the session's first written at or after the turn's send (an audit holds
    one per turn)."""
    for r in jsonl(path):
        if r.get('type') == 'result' and (session_id is None or r.get('session_id') == session_id):
            at = r.get('_audit_timestamp')
            if isinstance(at, str) and ts(at) >= since:
                return r
    return None


def missing_records(m, base):
    """What the manifest names that is not on disk, or no transcript named at all; such a row measures nothing."""
    if not m.get('transcript'):
        return 'no transcript in the manifest'
    named = [('transcript', m['transcript'])] + [(k, m[k]) for k in ('journal', 'audit') if m.get(k)] + [('relay log', p) for p in m.get('relay') or []]
    gone = ['%s %s' % (k, resolve(base, p)) for k, p in named if not os.path.isfile(resolve(base, p))]
    return 'records missing: ' + ', '.join(gone) if gone else None


def edit_row(manifest_path):
    with open(manifest_path, encoding='utf-8') as f:
        m = json.load(f)
    base = os.path.dirname(os.path.abspath(manifest_path))
    surface = m.get('surface') or ('maws' if m['arm'] == 'maws' else 'unknown')
    if m['arm'] == 'maws' and m.get('variant'):  # P4-A3: a lever's arm is a cell of its own
        surface = 'maws/%s' % m['variant']
    row = dict(arm=m['arm'], task=m['task'], rep=m['rep'], attempt=m.get('attempt') or 1, surface=surface, variant=m.get('variant'), build=m.get('build'),
               kind=m.get('kind'), host=m.get('host'), startedAt=m.get('startedAt'), manifest=os.path.relpath(manifest_path), sessionId=None, entrypoint=None,
               engine=None, route=None, load=m.get('load'), check=m.get('check'), pin=m.get('pin'), measurementOnly=bool(m.get('measurementOnly')),
               humanStop=m.get('humanStop'), seedId=m.get('seedId'), seedCheck=m.get('seedCheck'), freshSession=m.get('freshSession'), priorTurns=None,
               measured=None, error=missing_records(m, base))
    if row['error']:
        return row
    meta, api, turns = parse_transcript(resolve(base, m['transcript']))
    row.update(sessionId=meta['sessionId'], entrypoint=meta['entrypoint'], engine=meta['version'])
    match = m.get('promptMatch')  # the task's words after its {ref}, verbatim in both apps' prompts
    turn = None
    for i, t in enumerate(turns):
        p = t['prompt'] if isinstance(t['prompt'], str) else ' '.join(b.get('text', '') for b in t['prompt'] or [] if isinstance(b, dict))
        if match is None or match in p:
            turn = t
            # the human turns before it in its session: none in a fresh session, so more says the prompt went into an
            # existing one (the driver's New having failed) and the turn carried that session's context and cache
            row['priorTurns'] = i
            break
    if turn is None:
        row['error'] = 'no turn matched the prompt in the transcript'
        return row
    journal = parse_journal(resolve(base, m['journal'])) if m.get('journal') else None
    relay = parse_relay([resolve(base, p) for p in m.get('relay') or []], meta['sessionId']) if m.get('relay') else None
    audit = audit_result(resolve(base, m['audit']), meta['sessionId'], turn['send']) if m.get('audit') else None
    landing = tuple(m.get('landing') or DEFAULT_LANDING)
    x = measure(turn, api, journal, relay, audit, landing, m.get('landingActions'), m.get('landingFiles'))
    route = (journal or {}).get('route')
    if route is None and relay is not None:
        route = 'gateway' if x and x['relayJoined'] else 'direct (no relay rows for the session)'
    row.update(route=route, measured=x, error=None if x else 'the matched turn has no assistant record')
    return row


def label(r):
    return 'r%s' % r['rep'] if r['attempt'] == 1 else 'r%sa%d' % (r['rep'], r['attempt'])


# ---- cells and the verdict ------------------------------------------------------------------------------------------

def spread(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    q = statistics.quantiles(vals, n=4, method='inclusive') if len(vals) >= 2 else [vals[0]] * 3
    return dict(n=len(vals), median=rnd(statistics.median(vals)), min=rnd(vals[0]), max=rnd(vals[-1]), q1=rnd(q[0]), q3=rnd(q[2]))


MEASURES = ('sendToEditLanded', 'sendToFirstToken', 'sendToTurnEnd', 'requests', 'contextFirst', 'firstByteWait', 'generation',
            'serverHold', 'toolExec', 'mawsExec', 'toolSpanUnion', 'outputTokens', 'thinkingTokens', 'sendToLastLanding')
# P4-A3: the breakdown to the landing (measure()'s toLanding), per cell under these names
TO_LANDING = (('landingRequests', 'requests'), ('firstByteToLanding', 'firstByteWait'), ('generationToLanding', 'generation'),
              ('holdToLanding', 'serverHold'), ('thinkingToLanding', 'thinkingTokens'), ('outputToLanding', 'outputTokens'))
# What voids a task's verdict when both arms record it and the two differ (findings.txt §1); a control one arm's records
# lack is compared on nothing and said so beside the verdict.
VOIDING = (('models', 'model'), ('efforts', 'effort'), ('thinking', 'thinking'))


def valid(r):
    """A repetition counts when its records are there and its turn was found, its session's first; the turn ran in auto
    mode with no human stop; its edit landed and its checker passed; and a Cowork deck ran on a seed `before --seed` took
    (§7a), in another session than the seed's, the seed rebuilt and the bench's."""
    why = []
    x = r['measured']
    if x is None:
        why.append(r['error'])
    else:
        if x['sendToEditLanded'] is None:
            why.append('no landing call succeeded')
        if x['permissionMode'] != 'auto':
            why.append('permission mode %s, not auto' % x['permissionMode'])
    if r.get('priorTurns'):  # both arms: a MAWS repetition is always a new session's first turn
        why.append("the timed turn was not its session's first: %d earlier turn%s" % (r['priorTurns'], '' if r['priorTurns'] == 1 else 's'))
    if r.get('humanStop'):
        why.append('a human stop: %s' % r['humanStop'])
    if r.get('seedCheck') is not None and not r['seedCheck'].get('pass'):
        why.append("the seed was not the bench's: %s" % r['seedCheck'].get('detail'))
    if r['arm'] == 'desktop' and r.get('surface') == 'cowork' and r.get('kind') == 'presentation' and not r.get('seedId'):
        why.append('no seed: a Cowork deck repetition of the record takes before --seed (§7a)')
    if r.get('freshSession') is False:  # §7a: a timed turn runs in a fresh session, never in its seed's
        why.append("the timed turn ran in its seed's session, not a fresh one")
    if not (r.get('check') or {}).get('pass'):
        why.append('checker: %s' % ((r.get('check') or {}).get('detail') or 'not passed'))
    return why


def cells(rows):
    out = {}
    for r in rows:
        key = (r['task'], r['arm'], r['surface'])
        c = out.setdefault(key, dict(task=r['task'], arm=r['arm'], surface=r['surface'], reps=[], excluded=[]))
        why = valid(r)
        (c['excluded'] if why else c['reps']).append(r if not why else dict(rep=label(r), why=why))
    for c in out.values():
        reps = c['reps']
        c['measures'] = {k: spread([x['measured'].get(k) for x in reps]) for k in MEASURES}
        c['measures'].update({k: spread([(x['measured'].get('toLanding') or {}).get(f) for x in reps]) for k, f in TO_LANDING})
        c['controls'] = dict(models=sorted({m for x in reps for m in x['measured']['models']}),
                             requestedModels=sorted({m for x in reps for m in x['measured']['requestedModels']}), efforts=sorted({e for x in reps for e in x['measured']['efforts']}),
                             thinking=sorted({e for x in reps for e in x['measured']['thinking']}), thinkingSeen=sum(1 for x in reps if x['measured']['thinkingSeen']),
                             advisorModels=sorted({a for x in reps for a in x['measured']['advisorModels']}),
                             iterationTypes=sorted({t for x in reps for t in x['measured']['iterationTypes']}), routes=sorted({str(x['route']) for x in reps}),
                             engines=sorted({str(x['engine']) for x in reps}), entrypoints=sorted({str(x['entrypoint']) for x in reps}),
                             permissionModes=sorted({str(x['measured']['permissionMode']) for x in reps}),
                             cache=dict(cold=sum(1 for x in reps if x['measured']['cache']['state'] == 'cold'), warm=sum(1 for x in reps if x['measured']['cache']['state'] == 'warm')),
                             load1=spread([((x.get('load') or {}).get('before') or [None])[0] for x in reps]),
                             pins=sorted({json.dumps(x['pin']) for x in reps}), measurementOnly=any(x['measurementOnly'] for x in reps),
                             kinds=sorted({str(x['kind']) for x in reps}), hosts=sorted({str(x['host']) for x in reps}))
        c['repRows'] = reps  # the valid rows, for the verdict's bootstrap; not written to the report's JSON
        c['reps'] = [label(x) for x in reps]
    return out


BOOTSTRAP = dict(resamples=20000, level=0.95, seed=20261021)


def bootstrap(maws, desktop, resamples=BOOTSTRAP['resamples'], level=BOOTSTRAP['level'], seed=BOOTSTRAP['seed']):
    """The ratio of medians' percentile interval, each arm resampled with replacement on its own (A1's reading of B3's
    firmness, findings §7c), seeded so a record always gives the same interval. Reported beside the verdict; the rule
    has no band, so it never changes one."""
    rng = random.Random(seed)
    ratios = sorted(statistics.median(rng.choices(maws, k=len(maws))) / statistics.median(rng.choices(desktop, k=len(desktop))) for _ in range(resamples))
    tail = (1 - level) / 2
    return dict(low=rnd(ratios[int(tail * resamples)], 3), high=rnd(ratios[int((1 - tail) * resamples) - 1], 3),
                aboveThreshold=rnd(sum(1 for r in ratios if r > THRESHOLD) / resamples, 3), resamples=resamples, level=level, seed=seed)


def variant_of(surface):
    return surface.partition('/')[2] or '(none)'


def verdicts(cs, judge=None, maws=None):
    """Per task: MAWS's cell against the Desktop cell of its one surface, or of the surface `judge` names for the task when
    Desktop ran it on more than one; MAWS's one cell, or the variant `maws` names for the task when MAWS ran more than
    one (P4-A3's lever arms); the others are reported beside."""
    judge = judge or {}
    maws = maws or {}
    out = []
    for task in TASKS:
        ms = {c['surface']: c for c in cs.values() if c['task'] == task and c['arm'] == 'maws'}
        ds = {c['surface']: c for c in cs.values() if c['task'] == task and c['arm'] == 'desktop'}
        v = dict(task=task, verdict=None, ratio=None, surface=None, maws=None, why=[], beside=[])
        surface = next(iter(ds)) if len(ds) == 1 else judge.get(task)
        # a variant named is the one judged, whatever ran; with none named, the one cell MAWS ran is
        mkey = 'maws/%s' % maws[task] if task in maws else (next(iter(ms)) if len(ms) == 1 else None)
        m = ms.get(mkey) if mkey else None
        if m is not None:
            v['maws'] = m['surface'].partition('/')[2] or None
        if not ds:
            v['verdict'] = 'no verdict: no Desktop repetitions (a kind Desktop lacks reports its components alone)'
        elif not ms:
            v['verdict'] = 'no verdict: no MAWS repetitions'
        elif mkey is None:
            v['verdict'] = 'no verdict: MAWS ran more than one variant (%s); name the judged one (--maws %s=<variant>)' % (', '.join(sorted(variant_of(k) for k in ms)), task)
        elif m is None:
            v['verdict'] = 'no verdict: the judged MAWS variant %s has no repetitions (MAWS ran %s)' % (maws[task], ', '.join(sorted(variant_of(k) for k in ms)))
        elif surface is None:
            v['verdict'] = 'no verdict: Desktop ran on more than one surface (%s); name the judged one (--judge %s=<surface>)' % (', '.join(sorted(ds)), task)
        elif surface not in ds:
            v['verdict'] = 'no verdict: the judged surface %s has no Desktop repetitions (Desktop ran on %s)' % (surface, ', '.join(sorted(ds)))
        else:
            d = ds[surface]
            v['surface'] = surface
            mm, dm = m['measures']['sendToEditLanded'], d['measures']['sendToEditLanded']
            if not mm or not dm or mm['n'] < MIN_REPS or dm['n'] < MIN_REPS:
                v['verdict'] = 'no verdict yet: fewer than %d valid repetitions (MAWS %d, Desktop %d)' % (MIN_REPS, mm['n'] if mm else 0, dm['n'] if dm else 0)
            else:
                for k, name in VOIDING:
                    mv, dv = m['controls'][k], d['controls'][k]
                    if mv and dv and mv != dv:
                        v['why'].append('controls differ on %s: MAWS %s, Desktop %s' % (name, mv, dv))
                    for arm, vals, c in (('MAWS', mv, m), ('Desktop', dv, d)):
                        if not vals:
                            seen = ' (thinking seen in %d of %d repetitions)' % (c['controls']['thinkingSeen'], len(c['reps'])) if k == 'thinking' else ''
                            v['beside'].append("%s not in %s's records%s" % (name, arm, seen))
                for k, name in (('advisorModels', 'advisor model'), ('iterationTypes', 'non-message iterations'), ('requestedModels', 'requested model')):
                    if m['controls'][k] != d['controls'][k]:
                        v['beside'].append('%s: MAWS %s, Desktop %s (not voiding)' % (name, m['controls'][k], d['controls'][k]))
                v['ratio'] = rnd(mm['median'] / dm['median'], 3)
                b = v['bootstrap'] = bootstrap([x['measured']['sendToEditLanded'] for x in m['repRows']], [x['measured']['sendToEditLanded'] for x in d['repRows']])
                v['beside'].append("the ratio's %d%% bootstrap interval %s to %s (%s resamples within each arm, %d%% of them above %.1f; not part of the rule)" % (
                    round(b['level'] * 100), b['low'], b['high'], format(b['resamples'], ','), round(b['aboveThreshold'] * 100), THRESHOLD))
                if v['why']:
                    v['verdict'] = 'no verdict: the controls did not hold'
                else:
                    v['verdict'] = 'Desktop faster' if v['ratio'] > THRESHOLD else 'parity'
                v['measurementOnly'] = m['controls']['measurementOnly'] or d['controls']['measurementOnly']
        for s, c in sorted(ds.items()):
            if s != v['surface']:
                med = (c['measures']['sendToEditLanded'] or {}).get('median')
                mmed = ((m or {}).get('measures', {}).get('sendToEditLanded') or {}).get('median')
                v['beside'].append('Desktop on %s, not judged: median %s over %d valid (MAWS/that %s)' % (
                    s, fmt(med), len(c['reps']), fmt(rnd(mmed / med, 3)) if med and mmed else '-'))
        for s, c in sorted(ms.items()):
            if s != mkey:
                med = (c['measures']['sendToEditLanded'] or {}).get('median')
                dmed = ((ds.get(v['surface']) or {}).get('measures', {}).get('sendToEditLanded') or {}).get('median')
                v['beside'].append('MAWS %s, not judged: median %s over %d valid (that/Desktop %s)' % (
                    variant_of(s), fmt(med), len(c['reps']), fmt(rnd(med / dmed, 3)) if med and dmed else '-'))
        out.append(v)
    return out


def collect(paths):
    found = []
    for p in paths:
        if os.path.isdir(p):
            found += sorted(glob.glob(os.path.join(p, '**', 'manifest*.json'), recursive=True))
        else:
            found.append(p)
    return found


def fmt(x):
    return '-' if x is None else ('%.1f' % x if isinstance(x, float) else str(x))


def print_report(rows, cs, vs):
    print('per edit: arm task rep surface | landed first-token turn-end | req ctx0 | first-byte gen hold exec maws | out think | cache | route load1 | check')
    for r in sorted(rows, key=lambda r: (r['task'], r['rep'], r['attempt'], r['arm'], r['surface'])):
        x = r['measured'] or {}
        print('%-7s %s %-5s %-6s | %6s %6s %6s | %2s %7s | %5s %5s %5s %5s %5s | %5s %5s | %-4s | %s %s | %s%s' % (
            r['arm'], r['task'], label(r), r['surface'], fmt(x.get('sendToEditLanded')), fmt(x.get('sendToFirstToken')), fmt(x.get('sendToTurnEnd')),
            fmt(x.get('requests')), fmt(x.get('contextFirst')), fmt(x.get('firstByteWait')), fmt(x.get('generation')), fmt(x.get('serverHold')),
            fmt(x.get('toolExec')), fmt(x.get('mawsExec')), fmt(x.get('outputTokens')), fmt(x.get('thinkingTokens')),
            (x.get('cache') or {}).get('state', '-'), r['route'], fmt(((r.get('load') or {}).get('before') or [None])[0]),
            'pass' if (r.get('check') or {}).get('pass') else 'FAIL', '' if not valid(r) else ' (excluded: %s)' % '; '.join(map(str, valid(r)))))
    print('\ncells (median [min..max], n): send to edit landed | first token | turn end | requests | output tokens')
    for (task, arm, surface), c in sorted(cs.items()):
        f = lambda k: '-' if not c['measures'][k] else '%s [%s..%s] n=%d' % (c['measures'][k]['median'], c['measures'][k]['min'], c['measures'][k]['max'], c['measures'][k]['n'])
        print('%s %-7s %-6s | %s | %s | %s | %s | %s | controls %s%s' % (task, arm, surface, f('sendToEditLanded'), f('sendToFirstToken'), f('sendToTurnEnd'), f('requests'),
                                                                             f('outputTokens'), json.dumps({k: c['controls'][k] for k in ('models', 'efforts', 'thinking', 'advisorModels', 'routes', 'cache')}),
                                                                             '; excluded %s' % c['excluded'] if c['excluded'] else ''))
    print('\nverdict (threshold %.1f x, at least %d repetitions per cell):' % (THRESHOLD, MIN_REPS))
    for v in vs:
        print('%s: %s%s%s%s%s%s' % (v['task'], v['verdict'], ' (Desktop on %s)' % v['surface'] if v['surface'] else '',
                                    '' if v['ratio'] is None else ' (MAWS/Desktop median %.3f)' % v['ratio'], ' [measurement-only]' if v.get('measurementOnly') else '',
                                    '; ' + '; '.join(v['why']) if v['why'] else '', ''.join('\n    beside: %s' % b for b in v['beside'])))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('turns')
    a.add_argument('transcript')
    a.add_argument('--journal')
    a.add_argument('--relay', nargs='*', default=None)
    a.add_argument('--audit')
    a.add_argument('--all', action='store_true', help='every human turn, not only those with a landing call')
    a.add_argument('--json')
    b = sub.add_parser('edit')
    b.add_argument('manifest')
    c = sub.add_parser('report')
    c.add_argument('paths', nargs='+')
    c.add_argument('--json')
    c.add_argument('--judge', action='append', default=[], metavar='TASK=SURFACE', help="the Desktop surface judged for a task Desktop ran on more than one (B5=cowork)")
    c.add_argument('--maws', action='append', default=[], metavar='TASK=VARIANT', help="the MAWS variant judged for a task MAWS ran in more than one (B3=alwaysLoad)")
    args = ap.parse_args(argv)
    if args.cmd == 'turns':
        meta, api, turns = parse_transcript(args.transcript)
        journal = parse_journal(args.journal) if args.journal else None
        relay = parse_relay(args.relay, meta['sessionId']) if args.relay else None
        print('session %s, entrypoint %s, engine %s, %d human turns, %d api-request records%s%s' % (
            meta['sessionId'], meta['entrypoint'], meta['version'], len(turns), len(api), ', journal route %s' % journal['route'] if journal else '',
            ', relay rows %d' % len(relay) if relay is not None else ''))
        print('| turn (UTC) | edit | send→first block | send→first token | send→edit landed | send→turn end | API calls | first-byte wait | generation | server hold | tool exec | MAWS exec | output tok | thinking tok | context (k tok) | cache | effort | sources | tool sequence |')
        print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
        out = []
        for t in turns:
            r = measure(t, api, journal, relay)
            if r is None or (not args.all and r['landing'] is None):
                continue
            out.append(r)
            ctx = [q['ctx'] for q in r['perRequest']]
            print('| %s (%s) | %s | %s | %s | %s | %s | %d | %s | %s | %s | %s | %s | %d | %d | %d-%d | %s | %s | %s | %s |' % (
                r['turn'], r['sendAt'][11:16], (r['landing'] or {}).get('name', '-'), fmt(r['sendToFirstBlock']), fmt(r['sendToFirstToken']),
                fmt(r['sendToEditLanded']), fmt(r['sendToTurnEnd']), r['requests'], fmt(r['firstByteWait']), fmt(r['generation']), fmt(r['serverHold']),
                fmt(r['toolExec']), fmt(r['mawsExec']), r['outputTokens'], r['thinkingTokens'], min(ctx) // 1000, max(ctx) // 1000, r['cache']['state'],
                '/'.join(r['efforts']), ', '.join(r['sources']), ' → '.join(x['name'].replace('artifact_', '') for x in r['tools'])))
        if args.json:
            with open(args.json, 'w', encoding='utf-8') as f:
                json.dump(out, f, indent=1)
    elif args.cmd == 'edit':
        print(json.dumps(edit_row(args.manifest), indent=1))
    else:
        judge = {}
        for spec in args.judge:
            task, _, surface = spec.partition('=')
            if task not in TASKS or not surface:
                ap.error('--judge takes TASK=SURFACE, e.g. B5=cowork, not %r' % spec)
            judge[task] = surface
        maws = {}
        for spec in args.maws:
            task, _, variant = spec.partition('=')
            if task not in TASKS or not variant:
                ap.error('--maws takes TASK=VARIANT, e.g. B3=alwaysLoad, not %r' % spec)
            maws[task] = variant
        rows = [edit_row(p) for p in collect(args.paths)]
        cs = cells(rows)
        vs = verdicts(cs, judge, maws)
        print_report(rows, cs, vs)
        if args.json:
            with open(args.json, 'w', encoding='utf-8') as f:
                json.dump(dict(rows=rows, cells=[{k: x for k, x in c.items() if k != 'repRows'} for c in cs.values()], verdicts=vs, judge=judge, maws=maws,
                               threshold=THRESHOLD, minReps=MIN_REPS, bootstrap=BOOTSTRAP), f, indent=1, default=str)


if __name__ == '__main__':
    main(sys.argv[1:])
