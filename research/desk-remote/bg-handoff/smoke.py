import sys, time, json, os
sys.path.insert(0, "/private/tmp/bg-handoff")
import hb
e = hb.Env("smoke2")
e.setup()
p = e.headless([], "h1")
e.send(p, "Reply with just the word READY.")
end = time.time() + 90
while time.time() < end:
    recs = [json.loads(r["line"]) for r in hb.records(os.path.join(e.out, "h1.jsonl")) if r["line"].startswith("{")]
    if any(r.get("type") == "result" for r in recs):
        break
    time.sleep(1)
p.stdin.close()
p.wait(timeout=30)
init = [r for r in recs if r.get("type") == "system" and r.get("subtype") == "init"]
if init:
    i = init[0]
    print("tools:", sorted(t for t in i.get("tools", []) if not t.startswith("mcp__")))
    print("mcp:", i.get("mcp_servers"), [t for t in i.get("tools", []) if t.startswith("mcp__")])
    print("model:", i.get("model"), "version:", i.get("claude_code_version"), "session:", i.get("session_id"))
print([ (r.get("type"), r.get("subtype"), (r.get("result") or "")[:80]) for r in recs if r.get("type") in ("result",)])
print("debug dir:", os.listdir(os.path.join(e.root, "debug")) if os.path.isdir(os.path.join(e.root, "debug")) else None)
