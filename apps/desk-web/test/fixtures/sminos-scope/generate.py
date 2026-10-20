#!/usr/bin/env python3
"""Writes scope-labels.json beside this file: how sminos names a broadcast and a copy's destinations, computed by
sminos's own code, for the web app's suite to hold `scopeLabel`, `broadcastLabel` and `crossProject`
(src/conversation/stream.ts) to.

sminos 1.2.0 (doperpowers PR #297; the org directory's §5a) sends a message to a scope (`sminos say --org | --project |
--machine | --here | --state`): each project's event carries a `scope`, and the sender's copy, when several projects'
events deliver it, a list of `"<project id>:<writer>:<seq>"` under `copy`. The expected strings are the output of
`scope_label`, `target_label` and `chat_line` in doperpowers' sminos/skills/sminos/scripts/sminos.py, run here with
`project_label` reading the fixed `projects` names below (a project not named stands as its id, as sminos's does). The
first six scopes are the ones sminos's own tests/test-broadcast.sh sends, with the labels it asserts. Run it, with the
path to a doperpowers checkout's sminos scripts, whenever sminos's naming changes, and commit both files:

    python3 -I apps/desk-web/test/fixtures/sminos-scope/generate.py <doperpowers>/sminos/skills/sminos/scripts [<commit>]
"""

import json
import os
import re
import sys
import tempfile

SCRIPTS = sys.argv[1]
SOURCE = sys.argv[2] if len(sys.argv) > 2 else "unrecorded"
# sminos reads its home at import: point it at an empty one.
HOME = tempfile.mkdtemp(prefix="scope-labels-")
os.environ["HOME"] = HOME
os.environ["SMINOS_HOME"] = os.path.join(HOME, "sminos")
os.environ.pop("CLAUDE_CODE_SESSION_ID", None)
sys.path.insert(0, SCRIPTS)
import sminos  # noqa: E402

PROJ_A = "1f0c6a52-6a0e-4a4b-9a55-0c2d7c1e9a11"
PROJ_B = "7d3b9e40-52c4-4f1e-8f0a-2b6c5d4e3f22"
BETA_MP = "c2a8e5f1-3b47-5d9e-a6c0-91f2e4d8b733"  # beta's machine project, named as its machine
UNKNOWN = "e9d4c3b2-a1f0-4e8d-9c7b-6a5f4e3d2c44"  # a project this machine does not know
PROJECTS = {PROJ_A: "projA", PROJ_B: "projB", BETA_MP: "beta"}
sminos.project_label = lambda pid: PROJECTS.get(pid, pid)

LABELS = [
    ({"machines": ["beta"]}, "--machine beta (test-broadcast.sh)", "@all on beta"),
    ({"projects": [PROJ_B], "machines": ["beta"]}, "--project projB --machine beta (test-broadcast.sh)", "@all in projB on beta"),
    ({"projects": [PROJ_B, BETA_MP]}, "--project projB,beta (test-broadcast.sh)", "@all in projB,beta"),
    ({}, "--org (test-broadcast.sh)", "@org"),
    ({"here": "alpha"}, "--here on alpha (test-broadcast.sh)", "@all on alpha"),
    ({"states": ["waiting"]}, "--state waiting (test-broadcast.sh)", "@org (waiting)"),
    ({"machines": ["beta", "mini"], "here": "alpha"}, "--machine beta,mini --here: here's machine last", None),
    ({"projects": [PROJ_B], "states": ["busy", "idle"]}, "--project projB --state busy,idle", None),
    ({"projects": [PROJ_A, PROJ_B], "machines": ["beta"], "here": "alpha", "states": ["waiting"]}, "every key", None),
    ({"projects": [UNKNOWN]}, "a project not known here stands as its id", None),
    ({"machines": ["SK.local"], "states": ["busy"]}, "a machine name with a dot and capitals", None),
    ({"projects": "projB", "machines": [3, "beta", None], "here": "", "states": []}, "values not lists of words are passed over", None),
    ({"here": 7, "states": "waiting"}, "a here that is not a name, states not a list: the whole org", None),
]

TS = "2026-10-20T08:00:00.000Z"
WRITER = "alpha/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
TO = [{"session": "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f", "alias": "rb"}]
EVENTS = [
    ({"wake": True, "to": TO}, "a bare @all: no scope"),
    ({"wake": True, "to": TO, "scope": {"machines": ["beta"]}}, "a delivering event of say --machine beta"),
    ({"wake": True, "to": TO, "scope": {}}, "a delivering event of say --org"),
    ({"wake": True, "to": TO, "scope": "beta"}, "a scope that is not an object: a bare @all"),
    ({"wake": True, "to": [dict(TO[0], project=PROJ_B)], "scope": {"projects": [PROJ_B], "machines": ["beta"]},
      "copy": "%s:%s:4" % (PROJ_B, WRITER)}, "a copy of one project's event: copy a string (test-broadcast.sh)"),
    ({"wake": True, "to": [dict(TO[0], project=PROJ_B), {"session": "8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5968", "alias": "mb", "project": BETA_MP}],
      "scope": {"projects": [PROJ_B, BETA_MP]}, "copy": ["%s:%s:5" % (PROJ_B, WRITER), "%s:%s:2" % (BETA_MP, WRITER)]},
     "a copy of two projects' events: copy a list (test-broadcast.sh)"),
    ({"wake": True, "to": [dict(TO[0], project=UNKNOWN)], "scope": {"states": ["idle"]}, "copy": ["%s:%s:9" % (UNKNOWN, WRITER)]},
     "a copy whose list holds one event, in a project not known here"),
    ({"to": [dict(TO[0], project=PROJ_B)], "copy": "%s:%s:6" % (PROJ_B, WRITER)}, "a copy of a tagged say, before 1.2.0 as since"),
]


def label_case(scope, why, asserted):
    label = sminos.scope_label(scope)
    if asserted is not None and label != asserted:
        sys.exit("scope_label(%r) is %r, but test-broadcast.sh asserts %r" % (scope, label, asserted))
    return {"scope": scope, "label": label, "why": why}


def event_case(fields, why):
    event = dict({"ts": TS, "writer": WRITER, "seq": 4, "kind": "say", "from": "sa", "text": "beta reboots at three"}, **fields)
    target = sminos.target_label(event)
    line = sminos.chat_line(event)
    # chat_line: `<hh:mm:ss> <ref> <from> → <target>[ → <destinations>]  <text>`.
    m = re.match(r"^\S+ \S+ %s → %s(?: → (.*))?  %s$" % (re.escape(event["from"]), re.escape(target), re.escape(event["text"])), line)
    if not m:
        sys.exit("chat_line(%r) is %r: not the shape this generator reads" % (event, line))
    return {"event": event, "target": target, "destinations": m.group(1), "chat": line, "why": why}


out = {
    "about": "How sminos names a broadcast's scope and a copy's destinations, written by generate.py beside this file from "
             "sminos's own scope_label, target_label and chat_line; see its docstring.",
    "source": "doperpowers %s sminos/skills/sminos/scripts/sminos.py" % SOURCE,
    "projects": PROJECTS,
    "labels": [label_case(*c) for c in LABELS],
    "events": [event_case(*c) for c in EVENTS],
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scope-labels.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("wrote %s: %d labels, %d events" % (path, len(out["labels"]), len(out["events"])))
