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
top-level field, carries the value alone as `mac` and is covered without it.

Numbers follow RFC 8785 §3.2.2.3: every number, integral or not, is the IEEE-754 double nearest it, written as
ECMAScript's Number::toString writes that double (`es_number` below). A tool input in `raised` is arbitrary JSON, so
fractions, exponents, and integers past 2^53 all occur; a Python implementation converts every int and float with
float() and formats the result, never str(int).
"""

import base64
import hashlib
import hmac
import json
import os
from decimal import Decimal

DOMAINS = {
    "log": "smns-hub-log-v1",
    "rpc": "smns-hub-rpc-v1",
    "raised": "smns-hub-raised-v1",
    "settled": "smns-hub-settled-v1",
    "delivery": "smns-hub-delivery-v1",
}


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def es_number(value):
    """ECMAScript's Number::toString of the IEEE-754 double nearest `value` (RFC 8785 §3.2.2.3).

    float() takes an int to its nearest double (2**53 + 1 becomes 2**53; past about 1.8e308 it raises OverflowError).
    repr() of a float is the shortest decimal string that reads back as the same double, as ECMAScript's digits are;
    only the layout differs, and ECMAScript's is applied here: plain digits while the decimal exponent n of the
    leading digit position is between -6 and 21, otherwise d[.ddd]e+N / e-N."""
    x = float(value)
    if x != x or x in (float("inf"), float("-inf")):
        raise TypeError("not a JSON number: %r" % (value,))
    if x == 0:
        return "0"  # negative zero too
    if x < 0:
        return "-" + es_number(-x)
    _, digit_tuple, exponent = Decimal(repr(x)).as_tuple()
    digits = list(digit_tuple)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    s = "".join(str(d) for d in digits)
    k = len(s)
    n = k + exponent  # the value is 0.s * 10**n
    if k <= n <= 21:
        return s + "0" * (n - k)
    if 0 < n <= 21:
        return s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + s
    e = n - 1
    return (s if k == 1 else s[0] + "." + s[1:]) + "e" + ("+" if e >= 0 else "-") + str(abs(e))


def jcs(value):
    """RFC 8785: keys ordered by their UTF-16 code units (not by code point, which Python's sort_keys uses), strings as
    ECMAScript's JSON.stringify writes them, numbers by es_number. A string with a lone surrogate fails at encoding."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return es_number(value)
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
# A tool input as a session might send one: a fraction, an exponent past the plain range, an integer past 2**53.
FRACTION_INPUT = {"command": "python3 -c 'import time; time.sleep(0.5)'", "timeout": 0.5, "budget": 1e21, "id": 2**53 + 1}

# (JSON text, its canonical form by ECMAScript's rules — written out here, not computed — and why it is a case).
NUMBERS = [
    ("0.5", "0.5", "a fraction"),
    ("-0", "0", "negative zero, as an integer literal"),
    ("-0.0", "0", "negative zero, as a fraction literal"),
    ("100", "100", "an integer"),
    ("1e20", "100000000000000000000", "the largest power of ten written plainly"),
    ("1e21", "1e+21", "the smallest power of ten written with an exponent"),
    ("123456789012345680000", "123456789012345680000", "a large integral value, plainly"),
    ("1.2345678901234568e21", "1.2345678901234568e+21", "a large integral value, past the plain range"),
    ("1e-6", "0.000001", "the smallest power of ten written plainly"),
    ("1e-7", "1e-7", "the largest power of ten below 1 written with an exponent"),
    ("-1.5e-7", "-1.5e-7", "a negative fraction with an exponent"),
    ("9007199254740992", "9007199254740992", "2^53, the last integer every double holds"),
    ("9007199254740993", "9007199254740992", "2^53 + 1, which no double holds: it becomes 2^53"),
    ("333333333.33333329", "333333333.3333333", "RFC 8785's sample: the shortest digits that round-trip"),
    ("4.50", "4.5", "RFC 8785's sample: trailing zeros go"),
    ("2e-3", "0.002", "RFC 8785's sample"),
    ("1E30", "1e+30", "RFC 8785's sample"),
    ("0.000000000000000000000000001", "1e-27", "RFC 8785's sample"),
    ("5e-324", "5e-324", "the smallest subnormal"),
    ("1.7976931348623157e308", "1.7976931348623157e+308", "the largest double"),
]


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
        "raised-fraction",
        "raised",
        PROJECT,
        {"request": "toolu_01FracTi0nEXAMPLE", "session": SESSION, "tool": "Bash", "input": FRACTION_INPUT, "mac": {"nonce": nonce(11)}},
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

    numbers = []
    for text, canonical, why in NUMBERS:
        assert es_number(json.loads(text)) == canonical, (text, es_number(json.loads(text)), canonical)
        numbers.append({"json": text, "canonical": canonical, "why": why})

    out = {
        "about": "DX1's authentication-code vectors, written by generate.py beside this file; see its docstring for the rule.",
        "numbers": numbers,
        "digests": [
            {"name": name, "input": value, "canonical": jcs(value), "input_sha256": input_sha256(value)}
            for name, value in (("bash-input", BASH_INPUT), ("input-with-fraction", FRACTION_INPUT))
        ],
        "vectors": vectors,
        "negatives": negatives,
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "codes.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
