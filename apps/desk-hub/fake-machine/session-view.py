#!/usr/bin/env python3
"""Builds recordings/session-view (DC9's acceptance recording) from recordings/two-subagents.

    python3 session-view.py        # from apps/desk-hub/fake-machine/; rewrites recordings/session-view/

The real recording stays as it was recorded; this adds rows synthesized in engine 2.1.300's shapes, never invented:
each group below names the row shapes it copies (DC8's shared vectors, dx4/dx4-jobs.json, first; real transcripts of
2.1.300-2.1.301, read for shape and scrubbed, where the vectors hold none), and recorded.json lists every synthesized
row's uuid under its group, with those sources. What it adds:

- older history: earlier turns of the same session, before the recorded segment, so the main transcript is more than
  one snapshot at the fake machine's budget (SNAPSHOT_ROW_BUDGET), with an automatic compaction between two of them
  (its boundary and summary), so paging to the first row crosses it;
- in the first turn, three background shells and a monitor started, and an async question of the ask mod asked;
- in alpha's transcript, a nested agent launched in the background, its own transcript, and its notification;
- mid-turn, a shell's completion notice, a monitor's event notice, and a `task_status` naming the monitor's file;
- while the session is idle, the question answered from the web and delivered as the plugin's prompt, whose turn stops
  the mockup server (`TaskStop`, then its `killed` notice) and adds MCP servers; the next turn removes one;
- after the last turn, the session's end (presence null), then a send from the human recorded undelivered;
- tasks/<taskId>.output: the suites' log (present), the monitor's (present); the server's is named and absent, and the
  watcher's row names a path under another session, which containment refuses.

Synthesized events (row-seen, agent spawn and stop, raised, settled, turn) are merged into events.jsonl by `_ms`, each
marked `_synth`; a row released by a row-seen is released with every row before it in its transcript, so each
synthesized row's time lies between its neighbours'. Deterministic: ids and uuids derive from fixed names.
"""

import hashlib
import json
import os
import shutil
import uuid
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "recordings", "two-subagents")
OUT = os.path.join(HERE, "recordings", "session-view")

NS = uuid.UUID("5e55e5e5-0dc9-4c1e-9a3b-000000000dc9")
B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def uid(name):
    return str(uuid.uuid5(NS, name))


def digest(name):
    return int.from_bytes(hashlib.sha256(name.encode()).digest(), "big")


def toolu(name):
    n, out = digest(name), ""
    for _ in range(22):
        n, r = divmod(n, 62)
        out += B62[r]
    return "toolu_01" + out


def msg_id(name):
    return "msg_011Cg4" + toolu(name)[8:24]


def req_id(name):
    return "req_011Cg4" + toolu("req" + name)[8:24]


def lines(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def dump(rows):
    return "".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in rows)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


# ---- the recording as recorded
recorded = json.load(open(os.path.join(SRC, "recorded.json"), encoding="utf-8"))
SESSION = recorded["session"]
MEMBER = recorded["member"]
main = lines(os.path.join(SRC, "transcript.jsonl"))
events = lines(os.path.join(SRC, "events.jsonl"))
ALPHA = "ad435b3acfda88bfa"
alpha = lines(os.path.join(SRC, "subagents", "agent-%s.jsonl" % ALPHA))
CWD = main[0]["cwd"]
SLUG = "".join(c if c.isalnum() else "-" for c in CWD)
TASKS = "/private/tmp/claude-501/%s/%s/tasks" % (SLUG, SESSION)
PEER = "5e0c1f2a-7b3d-4e8f-9a6b-1c2d3e4f5a6b"  # the recording's peer session: a path under its id is another session's

# The bridge's clock against the recording's (the loader's clockOf): a row written at _ms x carries this time.
offsets = sorted(e["t"] - e["_ms"] for e in events if "t" in e and "_ms" in e)
CLOCK = offsets[len(offsets) // 2]


def ts(ms):
    ms = int(round(ms))
    return datetime.fromtimestamp((CLOCK + ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % ((CLOCK + ms) % 1000)


# When the bridge named each recorded row (its block-row or row-seen): a synthesized row goes between its neighbours'.
named = {}
for e in events:
    if e.get("type") in ("block-row", "row-seen") and e.get("uuid") not in named:
        named[e["uuid"]] = e["_ms"]

ENVELOPE = {"userType": "external", "entrypoint": "cli", "cwd": CWD, "sessionId": SESSION, "version": "2.1.300", "gitBranch": "main"}
groups = {}
synth_events = []


def note(group, row):
    groups.setdefault(group, []).append(row["uuid"])
    return row


def event(ms, kind, **fields):
    ms = int(round(ms))
    synth_events.append(dict({"_ms": ms, "type": kind}, **fields, t=CLOCK + ms, _synth=True))


def assistant(name, ms, parent, content, agent=None, stop="tool_use"):
    row = {"parentUuid": parent, "isSidechain": agent is not None}
    if agent:
        row["agentId"] = agent
    row.update({
        "message": {"model": "claude-haiku-5-5", "id": msg_id(name), "type": "message", "role": "assistant", "content": content,
                    "container": None, "stop_reason": stop, "stop_sequence": None, "stop_details": None,
                    "usage": {"input_tokens": 2, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 26801, "output_tokens": 64,
                              "service_tier": "standard"}, "diagnostics": None, "context_management": None},
        "apiBlockIndex": 0, "requestId": req_id(name), "requestedModel": "claude-haiku-5-5[1m]", "type": "assistant", "uuid": uid(name),
        "timestamp": ts(ms), "effort": "medium", "perTurnEffort": "medium"})
    if agent is None:
        row["session_id"] = SESSION
    row.update(ENVELOPE)
    return row


def tool_use(name, tool, inp):
    return {"type": "tool_use", "id": toolu(name), "name": tool, "input": inp, "caller": {"type": "direct"}}


def result(name, ms, call, content, tur, agent=None, is_error=None):
    block = {"tool_use_id": call["message"]["content"][0]["id"], "type": "tool_result", "content": content}
    if is_error is not None:
        block["is_error"] = is_error
    row = {"parentUuid": call["uuid"], "isSidechain": agent is not None}
    if agent:
        row["agentId"] = agent
    row.update({"promptId": uid("prompt:" + name), "type": "user", "message": {"role": "user", "content": [block]}, "uuid": uid(name),
                "timestamp": ts(ms), "toolUseResult": tur, "sourceToolAssistantUUID": call["uuid"]})
    if agent is None:
        row["session_id"] = SESSION
    row.update(ENVELOPE)
    return row


def attachment(name, ms, parent, att, rendered=None, agent=None):
    row = {"parentUuid": parent, "isSidechain": agent is not None}
    if agent:
        row["agentId"] = agent
    row.update({"attachment": att, "type": "attachment", "uuid": uid(name), "timestamp": ts(ms)})
    if rendered is not None:
        row.update({"rendered": [{"content": "<system-reminder>\n%s\n</system-reminder>" % rendered}], "renderedRole": "system"})
    row.update(ENVELOPE)
    return row


def notification(task, status=None, tool=None, output=None, summary=None, ev=None):
    parts = ["<task-notification>", "<task-id>%s</task-id>" % task]
    if tool:
        parts.append("<tool-use-id>%s</tool-use-id>" % tool)
    if output:
        parts.append("<output-file>%s</output-file>" % output)
    if status:
        parts.append("<status>%s</status>" % status)
    if summary:
        parts.append("<summary>%s</summary>" % summary)
    if ev:
        parts.append("<event>%s</event>" % ev)
    parts.append("</task-notification>")
    return "\n".join(parts)


def queued(name, ms, parent, prompt, agent=None):
    """A task-notification taken into a running turn: the queued_command attachment (vectors; real 2.1.300 rows)."""
    att = {"type": "queued_command", "prompt": prompt, "source_uuid": uid("source:" + name), "delivery_id": uid("delivery:" + name),
           "commandMode": "task-notification", "origin": {"kind": "task-notification", "producer": "session-task"}, "timestamp": ts(ms)}
    return attachment(name, ms, parent, att, "[SYSTEM NOTIFICATION - NOT USER INPUT]\n%s" % prompt, agent)


def insert_after(rows, anchor, new):
    i = next(i for i, r in enumerate(rows) if r["uuid"] == anchor)
    rows[i + 1:i + 1] = new


def seen(rows, agent=None):
    for r in rows:
        event(ms_of[r["uuid"]], "row-seen", uuid=r["uuid"], agentId=agent)


ms_of = {}


def at(row, ms):
    ms_of[row["uuid"]] = ms
    return row


# ---- older history (shapes: the recording's own user prompt and assistant text rows; a real 2.1.300 Read call and its
# result, `toolUseResult {type: text, file}`, contents replaced by generated lines)
history = []
parent = None
COMPACTED_AFTER = 6  # the older turn after which the session compacted: early enough that pages, not the snapshot, hold it
base = datetime(2026, 10, 15, 16, 30, tzinfo=timezone.utc).timestamp() * 1000


def hts(minute, second):
    t = base + minute * 60_000 + second * 1000
    return datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


for k in range(1, 25):
    path = "%s/notes/part-%02d.md" % (CWD, k)
    numbered = ["notes part %02d, line %03d: the fake machine replays a recorded session, and the web pages its history." % (k, j) for j in range(1, 41)]
    prompt = {"parentUuid": parent, "isSidechain": False, "promptId": uid("h-prompt-id:%d" % k), "type": "user",
              "message": {"role": "user", "content": "Read notes part %02d and tell me what it says." % k},
              "uuid": uid("h-prompt:%d" % k), "timestamp": hts(2 * k, 0), "permissionMode": "default", **ENVELOPE}
    call = assistant("h-read:%d" % k, 0, prompt["uuid"], [tool_use("h-read:%d" % k, "Read", {"file_path": path})])
    call["timestamp"] = hts(2 * k, 3)
    res = result("h-read-result:%d" % k, 0, call, "\n".join("%d\t%s" % (j + 1, line) for j, line in enumerate(numbered)),
                 {"type": "text", "file": {"filePath": path, "content": "\n".join(numbered), "numLines": 40, "startLine": 1, "totalLines": 40}})
    res["timestamp"] = hts(2 * k, 4)
    text = "Part %02d is forty numbered lines about replaying a session and paging its history." % k
    reply = assistant("h-reply:%d" % k, 0, res["uuid"], [{"type": "text", "text": ("<message>%s</message>" % text) if k % 3 else text}], stop="end_turn")
    reply["timestamp"] = hts(2 * k, 9)
    for r in (prompt, call, res, reply):
        history.append(note("older history", r))
    parent = reply["uuid"]
    if k == COMPACTED_AFTER:
        # An automatic compaction between two turns of the older history (shapes: MAWS's committed disk fixture
        # test/fixtures/transcripts/w1-compact.jsonl lines 28-29, the boundary and its summary): the boundary starts a
        # new chain (parentUuid null, logicalParentUuid the last row before it), the summary hangs from it, and the next
        # prompt from the summary. The rows before it stay in the same file, so paging reaches them across it.
        boundary = {"parentUuid": None, "logicalParentUuid": parent, "isSidechain": False, "type": "system", "subtype": "compact_boundary",
                    "content": "Conversation compacted", "isMeta": False, "timestamp": hts(2 * k, 30), "uuid": uid("h-compact-boundary"),
                    "level": "info", "compactMetadata": {"trigger": "auto", "preTokens": 160214, "durationMs": 7309, "postTokens": 9873, "cumulativeDroppedTokens": 150341},
                    **ENVELOPE}
        summary = {"parentUuid": boundary["uuid"], "isSidechain": False, "promptId": uid("h-compact-prompt-id"), "type": "user",
                   "message": {"role": "user", "content": "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent:\n   The human asked for the notes, one part at a time; parts 01 to %02d were read and summarized.\n\n2. Pending Tasks:\n   - Read the remaining parts as asked." % k},
                   "isVisibleInTranscriptOnly": True, "isCompactSummary": True, "uuid": uid("h-compact-summary"), "timestamp": hts(2 * k, 30), **ENVELOPE}
        for r in (boundary, summary):
            history.append(note("older history", r))
        parent = summary["uuid"]

# ---- the first turn: three background shells and a monitor, then an async question (shapes: the vectors' case
# "background shells and monitors" — Bash with run_in_background, its result with toolUseResult.backgroundTaskId and the
# "Output is being written to:" text, Monitor and its result's toolUseResult {taskId, timeoutMs, persistent}; the ask
# mod's async call, its accepted result, from a real 2.1.300 transcript)
after_beta = next(r for r in main if r["uuid"].startswith("705b5048"))
BETA_RESULT = after_beta["uuid"]
lo = named[BETA_RESULT]
hi = named[main[main.index(after_beta) + 1]["uuid"]]
SHELLS = [
    ("bsuite7k2", "bash tests/run.sh > /tmp/run.log 2>&1", "Run the suites", TASKS),
    ("bserve4q9", "python3 -m http.server 8771", "Serve the mockups", TASKS),
    ("bwatch8m1", "npm run build -- --watch", "Watch the build", "/private/tmp/claude-501/%s/%s/tasks" % (SLUG, PEER)),
]
MONITOR = ("bmon3x7a0", "tail -F /tmp/run.log | grep --line-buffered FAIL", "failures of the suites")
jobs_rows, parent, step = [], BETA_RESULT, (hi - lo) / 12
ms = lo
for task, command, description, tasks in SHELLS:
    ms += step
    call = at(assistant("call:" + task, ms, parent, [tool_use("call:" + task, "Bash", {"command": command, "description": description, "run_in_background": True})]), ms)
    ms += step
    res = at(result("result:" + task, ms, call,
                    "Command running in background with ID: %s. Output is being written to: %s/%s.output. You will be notified when it completes. "
                    "To check interim output, use Read on that file path." % (task, tasks, task),
                    {"stdout": "", "stderr": "", "interrupted": False, "isImage": False, "noOutputExpected": False, "backgroundTaskId": task}, is_error=False), ms)
    jobs_rows += [call, res]
    parent = res["uuid"]
task, command, description = MONITOR
ms += step
mcall = at(assistant("call:" + task, ms, parent, [tool_use("call:" + task, "Monitor", {"command": command, "description": description, "timeout_ms": 1800000})]), ms)
ms += step
mres = at(result("result:" + task, ms, mcall, "Monitor started (task %s, expires in 30m unless the source ends first). You will be notified on each event." % task,
                 {"taskId": task, "timeoutMs": 1800000, "persistent": False}), ms)
jobs_rows += [mcall, mres]
for r in jobs_rows:
    note("background shells and a monitor", r)

ASK_RESULT = ("Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later "
              "message that quotes each question. Go on with work that does not depend on it.")
QUESTION = {"question": "Keep the mockup server running once the suites finish?", "header": "Mockups", "multiSelect": False,
            "options": [{"label": "Keep it running", "description": "Leave the server up for a later look."},
                        {"label": "Stop it", "description": "Stop the server; it can be started again."}]}
ms += step
ask = at(assistant("ask", ms, mres["uuid"], [tool_use("ask", "mcp__doperpowers__AskUserQuestion", {"async": True, "questions": [QUESTION]})]), ms)
ms += step
ask_res = at(result("ask-result", ms, ask, ASK_RESULT, ASK_RESULT), ms)
ASK_CALL = ask["message"]["content"][0]["id"]
ASK_REQUEST = "toolu_plugin_" + hashlib.sha256(b"session-view ask").hexdigest()[:32]
for r in (ask, ask_res):
    note("the ask mod's async question", r)
insert_after(main, BETA_RESULT, jobs_rows + [ask, ask_res])
seen(jobs_rows + [ask, ask_res])
ASK_RAISED = ms_of[ask["uuid"]] + 2
event(ASK_RAISED, "raised", request=ASK_REQUEST, tool="mcp__doperpowers__AskUserQuestion", input={"questions": [QUESTION]}, agentId=None,
      **{"async": True}, toolUseId=ASK_CALL)

# ---- the nested agent, in alpha's transcript (shapes: the recording's own Agent call and its async_launched result,
# with alpha's row envelope; the vectors' nested metas (parentAgentId, spawnDepth 2) and a notification taken into a
# running turn as a queued_command attachment; DX5's agent spawn and stop events as the recording's bridge wrote them)
NESTED = "a" + "".join(B36[(digest("nested") >> (5 * i)) % 16] for i in range(16))
ALPHA_PROMPT_SNAPSHOT = "33e57fe6-3bd6-47ff-9564-88c0977faaa5"
ALPHA_REPLY = "cb18600e-6bb1-451d-a280-42e2a7be1a2b"
lo, hi = named[ALPHA_PROMPT_SNAPSHOT], named[ALPHA_REPLY]
step = (hi - lo) / 8
NESTED_DESC = "Check the sea sentence"
NESTED_PROMPT = "Read the sentence about the sea and reply with exactly: nested done. Use no tools."
ncall = at(assistant("nested-call", lo + step, ALPHA_PROMPT_SNAPSHOT,
                     [tool_use("nested-call", "Agent", {"description": NESTED_DESC, "prompt": NESTED_PROMPT, "subagent_type": "general-purpose", "run_in_background": True})],
                     agent=ALPHA), lo + step)
NESTED_TOOL = ncall["message"]["content"][0]["id"]
NESTED_OUTPUT = "%s/%s.output" % (TASKS, NESTED)
nres = at(result("nested-result", lo + 2 * step, ncall, [{"type": "text", "text":
          "Async agent launched successfully.\nagentId: %s (internal ID)\nThe agent is working in the background. You will be notified automatically when it completes.\n"
          "output_file: %s" % (NESTED, NESTED_OUTPUT)}],
          {"isAsync": True, "status": "async_launched", "agentId": NESTED, "description": NESTED_DESC, "resolvedModel": "claude-haiku-5-5[1m]",
           "prompt": NESTED_PROMPT, "outputFile": NESTED_OUTPUT, "canReadOutputFile": True, "canContinueAgent": True}, agent=ALPHA), lo + 2 * step)
nnote = at(queued("nested-notification", lo + 6 * step, nres["uuid"],
                  notification(NESTED, "completed", NESTED_TOOL, NESTED_OUTPUT, 'Agent "%s" finished' % NESTED_DESC), agent=ALPHA), lo + 6 * step)
for r in (ncall, nres, nnote):
    note("the nested agent, in its parent's transcript", r)
insert_after(alpha, ALPHA_PROMPT_SNAPSHOT, [ncall, nres, nnote])
seen([ncall, nres, nnote], ALPHA)
nested_rows = [
    {"parentUuid": None, "isSidechain": True, "promptId": uid("nested-prompt-id"), "agentId": NESTED, "type": "user",
     "message": {"role": "user", "content": NESTED_PROMPT}, "uuid": uid("nested-prompt"), "timestamp": ts(lo + 2 * step + 5), **ENVELOPE},
    assistant("nested-reply", lo + 5 * step, uid("nested-prompt"), [{"type": "text", "text": "nested done."}], agent=NESTED, stop="end_turn"),
]
nested_rows[1]["attributionAgent"] = "general-purpose"
at(nested_rows[0], lo + 2 * step + 5)
at(nested_rows[1], lo + 5 * step)
for r in nested_rows:
    note("the nested agent's own transcript", r)
event(lo + 2 * step + 1, "agent", phase="spawn", agentId=NESTED, parentAgentId=ALPHA, subagentType="general-purpose", description=NESTED_DESC,
      name=None, background=True, model="claude-haiku-5-5[1m]", toolUseId=NESTED_TOOL)
seen(nested_rows, NESTED)
event(lo + 5 * step + 2, "agent", phase="stop", agentId=NESTED, agentType="general-purpose")
NESTED_META = {"agentType": "general-purpose", "launchedWithDefaults": True, "description": NESTED_DESC, "toolUseId": NESTED_TOOL,
               "parentAgentId": ALPHA, "spawnDepth": 2, "requestShape": "background", "requestNonInteractive": True}

# ---- mid-turn notices (shapes: the vectors' completion notice with <output-file>, a monitor's statusless event notice,
# and a task_status with outputFilePath and `shell`; real 2.1.300 attachments for the envelope and `rendered`)
BASH_RESULT = next(r for r in main if r["uuid"].startswith("0caf3520"))["uuid"]
after = main[next(i for i, r in enumerate(main) if r["uuid"] == BASH_RESULT) + 1]["uuid"]
lo, hi = named[BASH_RESULT], named[after]
step = (hi - lo) / 5
suite = SHELLS[0]
n1 = at(queued("suite-done", lo + step, BASH_RESULT, notification(suite[0], "completed", toolu("call:" + suite[0]), "%s/%s.output" % (TASKS, suite[0]),
                                                                     'Background command "%s" completed (exit code 0)' % suite[2])), lo + step)
n2 = at(queued("monitor-event", lo + 2 * step, n1["uuid"],
               "<task-notification>\n<task-id>%s</task-id>\n<summary>Monitor event: \"%s\"</summary>\n<event>FAIL test_plane</event>\n</task-notification>" % (MONITOR[0], MONITOR[2])),
        lo + 2 * step)
n3 = at(attachment("monitor-status", lo + 3 * step, n2["uuid"],
                   {"type": "task_status", "taskId": MONITOR[0], "taskType": "local_bash", "description": MONITOR[2], "status": "running", "deltaSummary": None,
                    "outputFilePath": "%s/%s.output" % (TASKS, MONITOR[0]), "shell": {"command": MONITOR[1], "kind": "monitor", "toolUseId": toolu("call:" + MONITOR[0])}},
                   "Task %s (type: local_bash) (status: running) (description: %s) You can read partial output at %s/%s.output" % (MONITOR[0], MONITOR[2], TASKS, MONITOR[0])),
        lo + 3 * step)
for r in (n1, n2, n3):
    note("a shell's completion, a monitor's event, a task_status", r)
insert_after(main, BASH_RESULT, [n1, n2, n3])
seen([n1, n2, n3])

# ---- the question answered while the session is idle, and the plugin's prompt turn (shapes: the ask mod's delivery as
# the plugin's prompt and its framing, and a TaskStop call with its success result, from real 2.1.300 rows; the
# vectors' `killed` notice; an mcp_instructions_delta as the recording's own)
STOP_HOOK = next(r for r in main if r["uuid"].startswith("f73d7bc8"))["uuid"]
nxt = main[next(i for i, r in enumerate(main) if r["uuid"] == STOP_HOOK) + 1]["uuid"]
lo, hi = named[STOP_HOOK], named[nxt]
SETTLE = lo + 500
event(SETTLE, "settled", request=ASK_REQUEST, winner="web", outcome="answered", by=MEMBER)
ANSWER_TEXT = 'Your questions have been answered: "%s"="Stop it". You can now continue with these answers in mind.' % QUESTION["question"]
prompt_ms = SETTLE + 100
plugin_prompt = at({"parentUuid": STOP_HOOK, "isSidechain": False, "promptId": uid("plugin-prompt-id"), "type": "user",
                    "message": {"role": "user", "content": "The doperpowers plugin sent a message:\nThe human responded to your async AskUserQuestion (call %s): %s\n\n"
                                "This is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. "
                                "Address the message above." % (ASK_CALL, ANSWER_TEXT)},
                    "uuid": uid("plugin-prompt"), "timestamp": ts(prompt_ms), "permissionMode": "default", "origin": {"kind": "plugin", "name": "doperpowers"},
                    "promptSource": "system", "turnOrigin": "system", "turnPosition": {"promptIndex": 2, "turnIndex": 4}, "queuePriority": "later", **ENVELOPE},
                   prompt_ms)
mcp_add = at(attachment("mcp-add", prompt_ms + 5, plugin_prompt["uuid"],
                        {"type": "mcp_instructions_delta", "addedNames": ["plugin:cua:cua_repl", "plugin:ptc:ptc"],
                         "addedBlocks": ["## plugin:cua:cua_repl\nUI automation through cua_repl.", "## plugin:ptc:ptc\nA persistent kernel for this session."],
                         "removedNames": []},
                        "# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n"
                        "## plugin:cua:cua_repl\nUI automation through cua_repl.\n\n## plugin:ptc:ptc\nA persistent kernel for this session."), prompt_ms + 5)
serve = SHELLS[1]
stop_call = at(assistant("stop", prompt_ms + 300, mcp_add["uuid"], [tool_use("stop", "TaskStop", {"task_id": serve[0]})]), prompt_ms + 300)
stopped = {"message": "Successfully stopped task: %s (%s)" % (serve[0], serve[1]), "task_id": serve[0], "task_type": "local_bash", "command": serve[1]}
stop_res = at(result("stop-result", prompt_ms + 350, stop_call, json.dumps(stopped, separators=(",", ":")), stopped), prompt_ms + 350)
killed = at(queued("serve-killed", prompt_ms + 400, stop_res["uuid"],
                   notification(serve[0], "killed", toolu("call:" + serve[0]), None, 'Task "%s" was stopped by the user' % serve[2])), prompt_ms + 400)
reply = at(assistant("stop-reply", prompt_ms + 600, killed["uuid"], [{"type": "text", "text": "You chose to stop it, so the mockup server is stopped."}], stop="end_turn"),
           prompt_ms + 600)
plugin_turn = [plugin_prompt, mcp_add, stop_call, stop_res, killed, reply]
for r in plugin_turn:
    note("the answer delivered, and its turn", r)
insert_after(main, STOP_HOOK, plugin_turn)
seen(plugin_turn)
event(prompt_ms, "turn", phase="start", turnId=plugin_prompt["uuid"], agentId=None, text=plugin_prompt["message"]["content"])
event(prompt_ms + 650, "turn", phase="complete", turnId=plugin_prompt["uuid"], agentId=None, reason="answer")
assert prompt_ms + 650 < hi

# The next turn (the count) removes one of them.
COUNT_PROMPT = next(r for r in main if r["uuid"].startswith("2abbb86c"))
nxt = main[main.index(COUNT_PROMPT) + 1]["uuid"]
mcp_drop = at(attachment("mcp-drop", (named[COUNT_PROMPT["uuid"]] + named[nxt]) // 2, COUNT_PROMPT["uuid"],
                         {"type": "mcp_instructions_delta", "addedNames": [], "addedBlocks": [], "removedNames": ["plugin:ptc:ptc"]}),
              (named[COUNT_PROMPT["uuid"]] + named[nxt]) // 2)
note("MCP servers added and removed", mcp_add)
note("MCP servers added and removed", mcp_drop)
insert_after(main, COUNT_PROMPT["uuid"], [mcp_drop])
seen([mcp_drop])

# ---- the end, and a send recorded undelivered
last = max(e["_ms"] for e in events)
END = (last // 1000 + 1) * 1000
presence = lines(os.path.join(SRC, "presence.jsonl"))
presence += [{"_ms": prompt_ms, "record": {"status": "busy", "waitingFor": None, "needs": None}},
             {"_ms": prompt_ms + 700, "record": {"status": "idle", "waitingFor": None, "needs": None}},
             {"_ms": END, "record": None}]
presence.sort(key=lambda p: p["_ms"])

own_log = os.path.join("log", "SK.local.%s.jsonl" % SESSION)
log = lines(os.path.join(SRC, own_log))
seq = max(e["seq"] for e in log)
log.append({"ts": ts(ASK_RAISED + 5), "writer": "SK.local/" + SESSION, "seq": seq + 1, "kind": "question", "from": "fakerec", "to": "host",
            "text": [QUESTION["question"]], "choices": [o["label"] for o in QUESTION["options"]], "src": ASK_CALL})
log.append({"ts": ts(prompt_ms + 20), "writer": "SK.local/" + SESSION, "seq": seq + 2, "kind": "answered", "from": "fakerec", "src": ASK_CALL, "text": ANSWER_TEXT})
human = [{"ts": ts(END + 1000), "writer": "SK.local/human", "seq": 1, "kind": "human", "from": "human", "to": [{"session": SESSION, "alias": "fakerec"}],
          "text": "Re-run the suites when you are back, please.", "msg_id": "5e551e17"}]
deliveries = lines(os.path.join(SRC, "deliveries.jsonl"))
deliveries.append({"_ms": END + 1100, "event": {"writer": "SK.local/human", "seq": 1}, "session": SESSION, "outcome": "recorded",
                   "reason": "the session is not running here (closed, or its membership ended): it is pushed nothing, and reads the log when it is back"})

# ---- write it
shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(SRC, OUT)
write(os.path.join(OUT, "transcript.jsonl"), dump(history + main))
write(os.path.join(OUT, "subagents", "agent-%s.jsonl" % ALPHA), dump(alpha))
write(os.path.join(OUT, "subagents", "agent-%s.jsonl" % NESTED), dump(nested_rows))
write(os.path.join(OUT, "subagents", "agent-%s.meta.json" % NESTED), json.dumps(NESTED_META, separators=(",", ":")))
merged = sorted(events + synth_events, key=lambda e: e["_ms"])  # stable: the recorded order among equal times
write(os.path.join(OUT, "events.jsonl"), dump(merged))
write(os.path.join(OUT, "presence.jsonl"), dump(presence))
write(os.path.join(OUT, own_log), dump(log))
write(os.path.join(OUT, "log", "SK.local.human.jsonl"), dump(human))
write(os.path.join(OUT, "deliveries.jsonl"), dump(deliveries))
suite_log = "".join("%s test_%s ... %s\n" % ("ok" if j % 9 else "FAIL", name, "%d ms" % (40 + j * 7))
                    for j, name in enumerate(["plane", "hub", "bridge", "uplink", "codes", "log", "outcomes", "policy"] * 12, start=1))
write(os.path.join(OUT, "tasks", "%s.output" % SHELLS[0][0]), suite_log + "96 tests, 10 failed\n")
write(os.path.join(OUT, "tasks", "%s.output" % MONITOR[0]), "FAIL test_plane\n")

SOURCES = {
    "older history": "the recording's own user prompt and assistant text rows; a real 2.1.300 Read call and its result (toolUseResult {type: text, file}), contents generated; the compaction's boundary and summary from MAWS's committed disk fixture test/fixtures/transcripts/w1-compact.jsonl (lines 28-29), trigger auto, summary text generated",
    "background shells and a monitor": "dx4-jobs.json case 'background shells and monitors' (Bash run_in_background, its result's backgroundTaskId and 'Output is being written to:' text, Monitor and its result's {taskId, timeoutMs, persistent}); the envelope of the recording's own rows",
    "the ask mod's async question": "a real 2.1.300 mcp__doperpowers__AskUserQuestion call with async true and its accepted result (sminos.py ASYNC_RESULT); the raised event's form as DX4 and the recording's own raised lines carry it",
    "the nested agent, in its parent's transcript": "the recording's own Agent call and async_launched result in alpha's envelope; dx4-jobs.json's nested metas (parentAgentId, spawnDepth 2) and queued_command notification; DX5 agent spawn and stop as the recording's bridge wrote them",
    "the nested agent's own transcript": "alpha's own prompt and reply rows",
    "a shell's completion, a monitor's event, a task_status": "dx4-jobs.json case 'background shells and monitors' (completion notice, statusless monitor event, task_status with outputFilePath and shell); real 2.1.300 queued_command and task_status attachments for source_uuid, origin and rendered",
    "the answer delivered, and its turn": "a real 2.1.300 plugin prompt delivering an async answer (origin plugin, its framing); a real TaskStop call and success result; dx4-jobs.json's killed notice; the recording's own mcp_instructions_delta",
    "MCP servers added and removed": "the recording's own mcp_instructions_delta (addedNames, addedBlocks, removedNames)",
}
recorded.setdefault("synthesized", {}).update({
    "built by": "fake-machine/session-view.py from recordings/two-subagents",
    "rows": {group: {"source": SOURCES[group], "uuids": uuids} for group, uuids in groups.items()},
    "events.jsonl": "lines marked _synth: the synthesized rows' row-seen, the nested agent's spawn and stop, the async question's raised and settled, the plugin prompt's turn",
    "presence.jsonl": "the plugin prompt's turn (busy, then idle), and the session's end (record null) after its last turn",
    "log/%s" % os.path.basename(own_log): "the async question's question and answered events (sminos.py host_events)",
    "log/SK.local.human.jsonl": "a send from the human on the machine (sminos.py record_message), after the session ended",
    "deliveries.jsonl": "the send's recorded outcome (sminos_outcomes.py's words for a closed session)",
    "tasks/": "%s.output (the suites' log) and %s.output (the monitor's): present; %s.output is named and absent; %s's row names a path under another session" % (SHELLS[0][0], MONITOR[0], SHELLS[1][0], SHELLS[2][0]),
    "subagents/agent-%s.*" % NESTED: "the nested agent (parent %s), its transcript and meta" % ALPHA,
})
write(os.path.join(OUT, "recorded.json"), json.dumps(recorded, indent=2, ensure_ascii=False) + "\n")
print("wrote %s: %d main rows (%d older), %d synthesized events, nested agent %s" % (OUT, len(history) + len(main), len(history), len(synth_events), NESTED))
