#!/usr/bin/env python3
"""Records a throwaway Claude Code session for the fake machine (DC3's M4).

It runs one short haiku session, wholly isolated, with doperpowers' bridge
loaded. The session starts two subagents, raises a permission prompt and a
question, and has one turn interrupted mid-response. While it runs, the
script keeps everything the fake machine replays:

    events.jsonl            the bridge's own stream (DX5 `GET /events`, what `sminos watch --json` prints), each line
                            with `_ms`, its arrival in ms from the first line
    presence.jsonl          the session record's `status`, `waitingFor`, and `needs`, each time they changed, with `_ms`
    transcript.jsonl        the session's transcript, as the engine wrote it
    subagents/agent-<id>.jsonl, agent-<id>.meta.json
    log/<writer>.jsonl      the project's log (what the bridge exported: `message`, `question`, `answered`, `joined`…)

The run is isolated as the plan's Constraints say. HOME, CLAUDE_CONFIG_DIR, and SMINOS_HOME
are temporary. A copy of doperpowers' plugin is loaded with `--plugin-dir`, and the session
runs in a tmux server of its own. No `--bg` job is started. The gateway keys reach the
session only through a 0600 env file in the temporary directory, which is removed at the
end whatever happens, as is the rest of the directory. Nothing of the caller's
`~/.claude`, `~/.claude.json`, plugin store, or `~/.claude/sminos` is read or written.

The script answers the requests the way the web would, through the bridge's DX5 decision
route, with `by` set to the recording's member placeholder (MEMBER). The fake machine
replaces that placeholder with the member it is told to act for.

    record.py --doperpowers <checkout> --out <dir>
"""

import argparse
import glob
import http.client
import json
import os
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

GATEWAY_KEYS = ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY")
BASE_KEYS = ("PATH", "TERM", "LANG", "USER", "LOGNAME", "SHELL", "TMPDIR")
PLUGIN_PARTS = (".claude-plugin", "hooks", "skills", "agents", "output-styles")
NAME = "fakerec"
#: The member the recording's web answers name; the fake machine puts its own member in its place.
MEMBER = "0" * 32

PROMPT = (
    "Do these four steps in order, and nothing else. "
    "1) In one message, launch two subagents in parallel with the Agent tool (subagent_type general-purpose, "
    "run_in_background false, so you wait for both). "
    "The first is told: 'Reply with exactly: alpha done. Use no tools.' "
    "The second is told: 'Write one short sentence about the sea, then reply with exactly: beta done. Use no tools.' "
    "2) After both return, run this Bash command: python3 -c \"open('recorded.txt', 'w').write('blue')\" "
    "3) Then ask me with the AskUserQuestion tool which color to use, with the options red and blue. "
    "4) Finally write one short paragraph to me about the chosen color, wrapped in <message></message> tags."
)
SECOND = "Count from one to three hundred in English words, one number per line, with no other text."


class Conn(http.client.HTTPConnection):
    def __init__(self, path, timeout=10):
        super().__init__("bridge", timeout=timeout)
        self.unix = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.unix)


def request(path, method, url, body=None, timeout=10):
    c = Conn(path, timeout)
    try:
        c.request(method, url, body=None if body is None else json.dumps(body))
        r = c.getresponse()
        text = r.read().decode()
        return r.status, (json.loads(text) if text else None)
    finally:
        c.close()


def wait_for(what, seconds, fn, every=0.2):
    deadline = time.time() + seconds
    while time.time() < deadline:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise TimeoutError("timed out after %ss waiting for %s" % (seconds, what))


class Recorder:
    def __init__(self, doperpowers, out):
        self.repo = doperpowers
        self.out = out
        self.root = tempfile.mkdtemp(prefix="fmr.", dir="/tmp")
        self.home = os.path.join(self.root, "home")
        self.cfg = os.path.join(self.home, ".claude")
        self.smh = os.path.join(self.root, "s")
        self.work = os.path.join(self.root, "work")
        self.plugin = os.path.join(self.root, "plugin")
        self.envfile = os.path.join(self.root, "env")
        self.tmux = ["tmux", "-L", "fmr-%d" % os.getpid(), "-f", "/dev/null"]
        self.lines = []        # (ms, line) from the bridge's stream
        self.presence = []     # (ms, record)
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.t0 = None
        self.session = None

    def ms(self):
        if self.t0 is None:
            self.t0 = time.time()
        return round((time.time() - self.t0) * 1000)

    def local_env(self):
        env = {k: os.environ[k] for k in BASE_KEYS if k in os.environ}
        env.update(HOME=self.home, SMINOS_HOME=self.smh, CLAUDE_CONFIG_DIR=self.cfg)
        return env

    def sminos(self):
        return os.path.join(self.repo, "skills", "sminos", "scripts", "sminos")

    def setup(self):
        missing = [k for k in GATEWAY_KEYS if k not in os.environ]
        if missing:
            sys.exit("record.py: the gateway keys are not in the environment: %s" % ", ".join(missing))
        os.makedirs(self.cfg)
        os.makedirs(self.smh, mode=0o700)
        os.makedirs(self.work)
        for part in PLUGIN_PARTS:
            shutil.copytree(os.path.join(self.repo, part), os.path.join(self.plugin, part),
                            ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        trusted = {"hasTrustDialogAccepted": True}
        with open(os.path.join(self.cfg, ".claude.json"), "w") as f:
            json.dump({"hasCompletedOnboarding": True,
                       "projects": {self.work: trusted, os.path.realpath(self.work): trusted}}, f)
        with open(os.path.join(self.cfg, "settings.json"), "w") as f:
            f.write("{}\n")
        subprocess.run(["git", "-c", "init.defaultBranch=main", "init", "-q", self.work], check=True)
        subprocess.run([self.sminos(), "project", "init", "--name", NAME], cwd=self.work, env=self.local_env(),
                       check=True, capture_output=True)
        env = self.local_env()
        env.update({k: os.environ[k] for k in GATEWAY_KEYS})
        env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"] = "1"
        fd = os.open(self.envfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            for k, v in sorted(env.items()):
                f.write("export %s=%s\n" % (k, shlex.quote(v)))

    def start_session(self):
        inner = "set -e; . %s; cd %s; exec claude --plugin-dir %s --model haiku --permission-mode default -n %s" % (
            shlex.quote(self.envfile), shlex.quote(self.work), shlex.quote(self.plugin), NAME)
        cmd = "env -i /bin/bash --noprofile --norc -c %s" % shlex.quote(inner)
        subprocess.run(self.tmux + ["new-session", "-d", "-s", "fmr", "-x", "200", "-y", "50", cmd], check=True)

    def pane(self):
        return subprocess.run(self.tmux + ["capture-pane", "-p", "-t", "fmr"], capture_output=True, text=True).stdout

    def prompt(self, text):
        subprocess.run(self.tmux + ["send-keys", "-t", "fmr", "-l", text], check=True)
        time.sleep(0.3)
        subprocess.run(self.tmux + ["send-keys", "-t", "fmr", "Enter"], check=True)

    def endpoint(self):
        return os.path.join(self.smh, "bridge", self.session + ".sock")

    def subscribe(self):
        while not self.stop.is_set():
            try:
                c = Conn(self.endpoint(), timeout=None)
                c.request("GET", "/events")
                r = c.getresponse()
                while not self.stop.is_set():
                    line = r.readline()
                    if not line:
                        break
                    if r.status == 200:
                        with self.lock:
                            self.lines.append((self.ms(), json.loads(line)))
                c.close()
            except (OSError, ValueError, http.client.HTTPException):
                pass
            time.sleep(0.1)

    def watch_presence(self):
        last = None
        while not self.stop.is_set():
            rec = None
            for path in glob.glob(os.path.join(self.cfg, "sessions", "*.json")):
                try:
                    with open(path) as f:
                        r = json.load(f)
                except (OSError, ValueError):
                    continue
                if r.get("sessionId") == self.session:
                    rec = {k: r.get(k) for k in ("status", "waitingFor", "needs")}
            if rec != last:
                with self.lock:
                    self.presence.append((self.ms(), rec))
                last = rec
            time.sleep(0.05)

    def seen(self, pred):
        with self.lock:
            return [e for _, e in self.lines if pred(e)]

    def timed(self, pred):
        with self.lock:
            return [(ms, e) for ms, e in self.lines if pred(e)]

    def turn_ends(self):
        return self.seen(lambda e: e.get("type") == "turn" and e.get("phase") == "complete" and e.get("agentId") is None)

    def run(self):
        self.setup()
        self.start_session()
        sock_dir = os.path.join(self.smh, "bridge")
        found = wait_for("the bridge's socket", 90, lambda: [n for n in os.listdir(sock_dir)
                                                             if n.endswith(".sock") and not n.startswith(".")]
                         if os.path.isdir(sock_dir) else None)
        self.session = found[0][:-5]
        wait_for("the endpoint", 20, lambda: os.path.exists(self.endpoint()))
        for target in (self.subscribe, self.watch_presence):
            threading.Thread(target=target, daemon=True).start()
        wait_for("the subscription's snapshot", 20, lambda: self.lines)
        print("session %s; recording" % self.session, flush=True)

        self.prompt(PROMPT)
        answered = set()
        deadline = time.time() + 300
        while True:
            if time.time() > deadline:
                raise TimeoutError("the first exchange did not end within 300 s")
            settled = {e["request"]: ms for ms, e in self.timed(lambda e: e.get("type") == "settled")}
            raised = self.seen(lambda e: e.get("type") == "raised")
            for r in raised:
                rid = r["request"]
                if rid in answered or rid in settled:
                    continue
                time.sleep(0.3)  # the web draws it, a human chooses
                answered.add(rid)
                questions = (r.get("input") or {}).get("questions")
                if questions:
                    answers = {q["question"]: "blue" for q in questions}
                    body = {"behavior": "allow", "updatedInput": {"answers": answers}, "by": MEMBER}
                else:
                    body = {"behavior": "allow", "by": MEMBER}
                status, answer = request(self.endpoint(), "POST", "/requests/%s/decision" % rid, body, timeout=15)
                print("  %s %s: %s %s" % (r.get("tool"), rid, status, answer), flush=True)
            asked = [r for r in raised if (r.get("input") or {}).get("questions")]
            if asked and all(r["request"] in settled for r in raised):
                last = max(settled.values())
                ends = [ms for ms, e in self.timed(lambda e: e.get("type") == "turn" and e.get("phase") == "complete"
                                                   and e.get("agentId") is None) if ms > last]
                if ends and self.ms() - ends[-1] > 3000:
                    break
            time.sleep(0.2)
        print("first exchange ended", flush=True)

        # A second turn, interrupted mid-response: a step that ends aborted.
        time.sleep(2)
        before = len(self.turn_ends())
        texts = lambda: len(self.seen(lambda e: e.get("type") == "chunk" and e.get("agentId") is None
                                      and (e.get("chunk") or {}).get("kind") == "text"))
        had = texts()
        self.prompt(SECOND)
        wait_for("the second turn's text", 120, lambda: texts() - had > 30)
        status, answer = request(self.endpoint(), "POST", "/command?wait=10000", {"op": "interrupt"}, timeout=15)
        print("  interrupt: %s %s" % (status, answer), flush=True)
        wait_for("the second turn's end", 60, lambda: len(self.turn_ends()) > before)
        time.sleep(3)  # the last rows' flush, usage, presence back to idle
        self.collect()

    def collect(self):
        self.stop.set()
        time.sleep(0.3)
        os.makedirs(os.path.join(self.out, "subagents"), exist_ok=True)
        os.makedirs(os.path.join(self.out, "log"), exist_ok=True)
        with self.lock:
            with open(os.path.join(self.out, "events.jsonl"), "w") as f:
                for ms, e in self.lines:
                    f.write(json.dumps({"_ms": ms, **e}, ensure_ascii=False) + "\n")
            with open(os.path.join(self.out, "presence.jsonl"), "w") as f:
                for ms, rec in self.presence:
                    f.write(json.dumps({"_ms": ms, "record": rec}, ensure_ascii=False) + "\n")
        [transcript] = glob.glob(os.path.join(self.cfg, "projects", "*", self.session + ".jsonl"))
        copy_rows(transcript, os.path.join(self.out, "transcript.jsonl"))
        for path in glob.glob(os.path.join(os.path.dirname(transcript), self.session, "subagents", "agent-*")):
            dest = os.path.join(self.out, "subagents", os.path.basename(path))
            if path.endswith(".jsonl"):
                copy_rows(path, dest)
            else:
                shutil.copy(path, dest)
        for path in glob.glob(os.path.join(self.smh, "projects", "*", "log", "**", "*.jsonl"), recursive=True):
            rel = os.path.relpath(path, glob.glob(os.path.join(self.smh, "projects", "*", "log"))[0])
            dest = os.path.join(self.out, "log", rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy(path, dest)
        subprocess.run(["git", "-C", self.work, "add", "-N", "."], capture_output=True)
        diff = subprocess.run(["git", "-C", self.work, "diff"], capture_output=True, text=True).stdout
        with open(os.path.join(self.out, "diff.patch"), "w") as f:
            f.write(diff)
        with open(os.path.join(self.out, "recorded.json"), "w") as f:
            json.dump({"session": self.session, "cwd": self.work, "member": MEMBER, "prompts": [PROMPT, SECOND]}, f, indent=2)
            f.write("\n")
        print("recorded into %s" % self.out, flush=True)

    def cleanup(self):
        self.stop.set()
        try:
            os.unlink(self.envfile)
        except OSError:
            pass
        subprocess.run(self.tmux + ["kill-server"], capture_output=True)
        try:
            wait_for("every process of the recording to end", 20, lambda: not _strays(self.root))
        except TimeoutError:
            for pid in _strays(self.root):
                os.kill(pid, signal.SIGKILL)
        left = _strays(self.root)
        print("cleanup: %s" % ("nothing left running" if not left else "STILL RUNNING: %s" % left), flush=True)
        shutil.rmtree(self.root, ignore_errors=True)


def copy_rows(src, dst):
    """Copies a transcript's rows: the lines carrying a `uuid` (the rows DX4 carries; the engine's request blobs and
    bookkeeping lines are left out), each verbatim but for a `prompt_snapshot` attachment, whose system prompt and
    tool definitions (over 100 KB of the engine's own text, the same in every session) are cut to their first 200
    characters, marked."""
    with open(src) as f, open(dst, "w") as out:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if "uuid" not in row:
                continue
            attachment = row.get("attachment")
            if isinstance(attachment, dict) and attachment.get("type") == "prompt_snapshot":
                for key, value in list(attachment.items()):
                    if key != "type":
                        attachment[key] = _cut(value)
                line = json.dumps(row, ensure_ascii=False) + "\n"
            out.write(line if line.endswith("\n") else line + "\n")


def _cut(value):
    text = json.dumps(value, ensure_ascii=False)
    return value if len(text) <= 200 else "[cut by record.py: %d characters] %s" % (len(text), text[:200])


def _strays(root):
    r = subprocess.run(["pgrep", "-f", root], capture_output=True, text=True)
    return [int(p) for p in r.stdout.split() if int(p) != os.getpid()]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--doperpowers", required=True, help="a doperpowers checkout with DC2's bridge")
    parser.add_argument("--out", required=True, help="the directory to write the raw recording into")
    args = parser.parse_args()
    rec = Recorder(os.path.abspath(args.doperpowers), os.path.abspath(args.out))
    print("recording in %s" % rec.root, flush=True)
    try:
        rec.run()
    except Exception as e:  # noqa: BLE001
        print("FAILED: %s: %s" % (type(e).__name__, e), flush=True)
        print("pane:\n" + "\n".join("  " + l for l in rec.pane().rstrip().splitlines()[-30:]), flush=True)
        try:
            rec.collect()  # what was recorded, for a look at why
        except Exception as again:  # noqa: BLE001
            print("nothing collected: %s" % again, flush=True)
        rec.cleanup()
        sys.exit(1)
    rec.cleanup()


if __name__ == "__main__":
    main()
