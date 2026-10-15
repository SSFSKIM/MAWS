#!/usr/bin/env python3
"""Writes codes.json: DX1's authentication-code vectors (docs/doperpowers/specs/2026-10-15-desk-design.md, DX1, DX4,
DX6; the DC3 plan's M1, Codes).

The expected bytes and codes come from this file, an implementation independent of the TypeScript one and written as the
daemon's will be (stdlib Python), so the TypeScript suite that checks them does not check itself. Run it from anywhere:

    python3 -I apps/desk-hub/src/protocol/vectors/generate.py

The rule, for every authenticated shape: the code is HMAC-SHA256, keyed with the org key, over

    <domain>\\n<project id>\\n<canonical JSON of the covered object>

where the canonical JSON is RFC 8785 (JCS) and the covered object is the shape without the code's value: a shape whose
`mac` is {nonce, value} is covered with `mac` reduced to {nonce}; a log event of a `hub/` writer leaves out `writer`,
`seq`, and `ts` too, which the hub assigns after the browser computed the code; an RPC, whose nonce is its own
top-level field, carries the value alone as `mac` and is covered without it. Every vector here holds integers only,
the only numbers these shapes carry.
"""

import base64
import hashlib
import hmac
import json
import os

DOMAINS = {
    "log": "smns-hub-log-v1",
    "rpc": "smns-hub-rpc-v1",
    "raised": "smns-hub-raised-v1",
    "settled": "smns-hub-settled-v1",
    "delivery": "smns-hub-delivery-v1",
}


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def jcs(value):
    """RFC 8785 for the values these shapes carry: keys ordered by their UTF-16 code units (not by code point, which
    Python's sort_keys uses), strings as ECMAScript's JSON.stringify writes them, integers only."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(jcs(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(key, ensure_ascii=False) + ":" + jcs(value[key]) for key in keys) + "}"
    raise TypeError("not canonicalizable: %r" % (value,))


def covered(shape, kind):
    if kind == "rpc":
        return {k: v for k, v in shape.items() if k != "mac"}
    out = dict(shape)
    out["mac"] = {"nonce": shape["mac"]["nonce"]}
    if kind == "log" and shape["writer"].startswith("hub/"):
        for key in ("writer", "seq", "ts"):
            out.pop(key)
    return out


def covered_bytes(kind, project, shape):
    text = DOMAINS[kind] + "\n" + project + "\n" + jcs(covered(shape, kind))
    return text.encode("utf-8")


def code(org_key, kind, project, shape):
    return b64url(hmac.new(org_key, covered_bytes(kind, project, shape), hashlib.sha256).digest())


def input_sha256(tool_input):
    return hashlib.sha256(jcs(tool_input).encode("utf-8")).hexdigest()


ORG_KEY = bytes(range(32))
PROJECT = "6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f"
OTHER_PROJECT = "0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59"
MEMBER = "4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c"
SESSION = "67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b"
REQUEST = "toolu_01QmZ7wq3V8nEXAMPLE"
BASH_INPUT = {"command": "pnpm e2e", "description": "Run the e2e suite"}


def nonce(n):
    return b64url(bytes([n] * 16))


CASES = [
    (
        "say-ascii",
        "log",
        PROJECT,
        {
            "ts": "2026-10-15T08:01:02.123Z",
            "writer": "SK.local/e0ad139c-18bc-45bd-9489-be8653145f80",
            "seq": 42,
            "kind": "say",
            "from": "doperpowers-1e",
            "to": [{"session": SESSION, "alias": "maws-45"}],
            "text": "your change renames a column I read",
            "mac": {"nonce": nonce(1)},
        },
    ),
    (
        "message-unicode",
        "log",
        PROJECT,
        {
            "ts": "2026-10-15T08:02:03.456Z",
            "writer": "mini/9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a",
            "seq": 7,
            "kind": "message",
            "from": "maws-45",
            "to": "host",
            "text": "컬럼 이름은 `user_id`로 유지할게요 🙂\n\tquote \" backslash \\ nul \u0000 unit-sep \u001f bs \b ff \f del \u007f ls   끝",
            "src": "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a:0",
            "mac": {"nonce": nonce(2)},
        },
    ),
    (
        "hub-human",
        "log",
        PROJECT,
        {
            "ts": "2026-10-15T08:05:00.000Z",
            "writer": "hub/" + MEMBER,
            "seq": 3,
            "kind": "human",
            "from": "human",
            "member": MEMBER,
            "to": [{"session": SESSION, "alias": "maws-45"}],
            "text": "keep user_id",
            "created": "2026-10-15T08:04:59.870Z",
            "mac": {"nonce": nonce(3)},
        },
    ),
    (
        "nested-object",
        "log",
        PROJECT,
        {
            "ts": "2026-10-15T08:06:00.001Z",
            "writer": "SK.local/e0ad139c-18bc-45bd-9489-be8653145f80",
            "seq": 43,
            "kind": "say",
            "from": "doperpowers-1e",
            "to": "*",
            "text": "every field is covered, unknown ones too",
            "meta": {
                "z": [1, -2, 0, 9007199254740991, True, False, None, {"b": "", "a": []}],
                "é": "e-acute (U+00E9)",
                "\U0001f600": "an astral key: UTF-16 orders it before U+E000, code points after",
                "": "a private-use key (U+E000)",
                "A": "upper",
                "a": "lower",
                "": "the empty key",
            },
            "mac": {"nonce": nonce(4)},
        },
    ),
    (
        "rpc-decide",
        "rpc",
        PROJECT,
        {
            "rpc": "decide",
            "project": PROJECT,
            "machine": "mini",
            "member": MEMBER,
            "created": "2026-10-15T08:07:00.000Z",
            "nonce": nonce(5),
            "args": {
                "session": SESSION,
                "decision": "allow",
                "digest": {"session": SESSION, "request": REQUEST, "tool": "Bash", "input_sha256": input_sha256(BASH_INPUT)},
            },
        },
    ),
    (
        "raised",
        "raised",
        PROJECT,
        {"request": REQUEST, "session": SESSION, "tool": "Bash", "input": BASH_INPUT, "mac": {"nonce": nonce(6)}},
    ),
    (
        "settled",
        "settled",
        PROJECT,
        {"request": REQUEST, "winner": "web", "outcome": "allow", "by": MEMBER, "mac": {"nonce": nonce(7)}},
    ),
    (
        "delivery",
        "delivery",
        PROJECT,
        {
            "event": {"writer": "hub/" + MEMBER, "seq": 3},
            "session": SESSION,
            "outcome": "recorded",
            "reason": "a terminal session the human closed",
            "mac": {"nonce": nonce(8)},
        },
    ),
]


def seal(kind, shape, value):
    out = json.loads(json.dumps(shape))
    if kind == "rpc":
        out["mac"] = value
    else:
        out["mac"]["value"] = value
    return out


def main():
    vectors = []
    sealed = {}
    for name, kind, project, shape in CASES:
        value = code(ORG_KEY, kind, project, shape)
        raw = covered_bytes(kind, project, shape)
        sealed[name] = (kind, project, seal(kind, shape, value))
        vectors.append(
            {
                "name": name,
                "domain": DOMAINS[kind],
                "org_key": b64url(ORG_KEY),
                "project": project,
                "input": sealed[name][2],
                "covered": raw.decode("utf-8"),
                "covered_hex": raw.hex(),
                "code": value,
            }
        )

    # Each negative carries a sealed shape altered after sealing; its `mac` value must not verify.
    negatives = []

    def negative(name, of, why, mutate, project=None, as_kind=None):
        kind, original_project, shape = sealed[of]
        altered = json.loads(json.dumps(shape))
        mutate(altered)
        target = project or original_project
        verify_as = as_kind or kind
        check = code(ORG_KEY, verify_as, target, altered)
        stored = altered["mac"] if kind == "rpc" else altered["mac"]["value"]
        assert check != stored, name
        negatives.append(
            {"name": name, "of": of, "why": why, "domain": DOMAINS[verify_as], "org_key": b64url(ORG_KEY), "project": target, "input": altered}
        )

    negative(
        "hub-human-fresh-nonce",
        "hub-human",
        "the hub re-sequenced a web human under a fresh nonce",
        lambda e: e["mac"].update(nonce=nonce(9)),
    )
    negative("say-text-changed", "say-ascii", "a covered field changed", lambda e: e.update(text="your change renames a column I write"))
    negative("hub-human-other-project", "hub-human", "a hub/ event moved to another project", lambda e: None, project=OTHER_PROJECT)
    negative("rpc-nonce-changed", "rpc-decide", "an RPC replayed under another nonce", lambda e: e.update(nonce=nonce(10)))
    negative("raised-as-settled", "raised", "a code for one shape offered as another's", lambda e: None, as_kind="settled")

    out = {
        "about": "DX1's authentication-code vectors, written by generate.py beside this file; see its docstring for the rule.",
        "digest": {"input": BASH_INPUT, "canonical": jcs(BASH_INPUT), "input_sha256": input_sha256(BASH_INPUT)},
        "vectors": vectors,
        "negatives": negatives,
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "codes.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
