#!/usr/bin/env python3
"""Writes machine-project.json: the machine project's id, as both implementations compute it (the sminos org directory,
docs/doperpowers/specs/2026-10-18-smns-org-directory-design.md in doperpowers, Interfaces and Dependencies).

Every enrolled machine has a hub project of its own, the project of its sessions that no `.smns` claims. Its id is
computable from the org and the machine's name alone, by the hub (`machineProjectId` in protocol/identity.ts) and by
sminos (`machine_project` in skills/sminos/scripts/sminos.py), so a machine can open its project before the hub has
listed it:

    uuid.uuid5(uuid.NAMESPACE_URL, "smns-machine:%s:%s" % (org, machine.lower()))

The machine's name is lower-cased, as the hub compares names (`machineNameKey`); the org is taken as it is. The expected
ids come from this file, Python's own uuid module, so the TypeScript suite that checks them does not check itself. A
copy of the output is committed in doperpowers as tests/sminos/machine-project-id.json, which sminos's parity test reads.
Run it from anywhere:

    python3 -I apps/desk-hub/src/protocol/vectors/generate-machine-project.py
"""

import json
import os
import uuid

CASES = [
    ("ssfskim", "macbook", "the owner's MacBook"),
    ("ssfskim", "mini", "the owner's Mac mini"),
    ("ssfskim", "devcloud-7f3a", "a devcloud host"),
    ("ssfskim", "MacBook", "a name in another case: the same id as its lower-cased spelling"),
    ("ssfskim", "SK.local", "a name with a dot and capitals"),
    ("org-local", "sp-1", "the local runtime's org"),
    ("o", "a", "the shortest name: one SHA-1 block"),
    ("ssfskim", "devcloud-012345678", "55 bytes hashed: the most one SHA-1 block holds with its padding"),
    ("ssfskim", "devcloud-0123456789", "56 bytes hashed: the padding takes a second block"),
    ("ssfskim", "m" * 63, "the longest admitted name: two SHA-1 blocks"),
    ("an-org-whose-id-is-long-enough-to-cross-a-block", "host_7", "a long org"),
]


def machine_project_id(org, machine):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "smns-machine:%s:%s" % (org, machine.lower())))


def main():
    out = {
        "about": "The machine project's id (the sminos org directory), written by generate-machine-project.py beside this file; see its docstring for the rule.",
        "namespace": str(uuid.NAMESPACE_URL),
        "vectors": [
            {"org": org, "machine": machine, "name": "smns-machine:%s:%s" % (org, machine.lower()), "id": machine_project_id(org, machine), "why": why}
            for org, machine, why in CASES
        ],
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "machine-project.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")


if __name__ == "__main__":
    main()
