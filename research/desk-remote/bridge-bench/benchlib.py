"""Shared scaffolding for the bridge benchmarks.

Reuses tests/mods/live-bridge-check.py's isolation (temp HOME/config dir,
temp SMINOS_HOME, staged plugin copy, own tmux server, 0600 env file) and adds
a headless (`claude -p` stream-json) runner plus timestamping readers.
"""

import http.client
import importlib.util
import json
import os
import shlex
import socket
import subprocess
import sys
import threading
import time

PLUGIN = "/Users/new/.claude/plugins/cache/doperpowers/sminos/1.1.1"
CLAUDE = "/Users/new/.local/share/claude/versions/2.1.304"
OUT = "/private/tmp/bridge-bench"

_spec = importlib.util.spec_from_file_location("lbc", os.path.join(PLUGIN, "tests/mods/live-bridge-check.py"))
lbc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lbc)


def clean_path():
    return ":".join(p for p in os.environ.get("PATH", "").split(":") if "cmux-cli-shims" not in p)


class Bench(lbc.Live):
    """One isolated environment. `hooks` decides CLAUDE_CODE_ENABLE_FUNCTION_HOOKS."""

    def __init__(self, hooks=True, keep=False, plugin_source=PLUGIN):
        super().__init__(keep)
        self.hooks = hooks
        self.plugin_source = plugin_source
        self.tmux = ["tmux", "-L", "brb-%d" % os.getpid(), "-f", "/dev/null"]

    def local_env(self):
        env = super().local_env()
        env["PATH"] = clean_path()
        return env

    def setup(self):
        missing = [k for k in lbc.GATEWAY_KEYS if k not in os.environ]
        if missing:
            sys.exit("gateway keys missing: %s" % ", ".join(missing))
        os.makedirs(self.cfg)
        os.makedirs(self.smh, mode=0o700)
        os.makedirs(self.work)
        lbc.stage(self.plugin_source, self.plugin, lbc.PLUGIN_PARTS)
        trusted = {"hasTrustDialogAccepted": True}
        with open(os.path.join(self.cfg, ".claude.json"), "w") as f:
            json.dump({"hasCompletedOnboarding": True,
                       "projects": {self.work: trusted, os.path.realpath(self.work): trusted}}, f)
        with open(os.path.join(self.cfg, "settings.json"), "w") as f:
            f.write("{}\n")
        subprocess.run(["git", "-c", "init.defaultBranch=main", "init", "-q", self.work], check=True)
        subprocess.run([self.sminos(), "project", "init", "--name", lbc.NAME], cwd=self.work, env=self.local_env(),
                       check=True, capture_output=True)
        self.write_env(self.hooks)

    def write_env(self, hooks, extra=None):
        env = self.local_env()
        env.update({k: os.environ[k] for k in lbc.GATEWAY_KEYS})
        if hooks:
            env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"] = "1"
        env.update(extra or {})
        try:
            os.unlink(self.envfile)
        except FileNotFoundError:
            pass
        fd = os.open(self.envfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            for k, v in sorted(env.items()):
                f.write("export %s=%s\n" % (k, shlex.quote(v)))

    def sminos(self):
        return os.path.join(PLUGIN, "skills", "sminos", "scripts", "sminos")

    # -- headless

    def headless(self, extra=(), stderr_path=None, model="haiku"):
        dirs = " ".join("--plugin-dir %s" % shlex.quote(d) for d in self.plugin_dirs())
        args = " ".join(shlex.quote(a) for a in extra)
        inner = ("set -e; . %s; cd %s; exec %s -p --input-format stream-json --output-format stream-json "
                 "--include-partial-messages --verbose --model %s %s %s") % (
            shlex.quote(self.envfile), shlex.quote(self.work), CLAUDE, model, dirs, args)
        err = open(stderr_path or os.devnull, "wb")
        p = subprocess.Popen(["env", "-i", "/bin/bash", "--noprofile", "--norc", "-c", inner],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, bufsize=0)
        self.procs.append(p)
        return p

    def start_session(self, extra=""):
        dirs = " ".join("--plugin-dir %s" % shlex.quote(d) for d in self.plugin_dirs())
        inner = "set -e; . %s; cd %s; exec %s %s --model haiku --permission-mode default -n %s %s" % (
            shlex.quote(self.envfile), shlex.quote(self.work), CLAUDE, dirs, lbc.NAME, extra)
        cmd = "env -i /bin/bash --noprofile --norc -c %s" % shlex.quote(inner)
        subprocess.run(self.tmux + ["new-session", "-d", "-s", "brl", "-x", "200", "-y", "50", cmd], check=True)

    def sock_dir(self):
        return os.path.join(self.smh, "bridge")

    def find_session(self, seconds=90, exclude=()):
        d = self.sock_dir()
        found = lbc.wait_for("the bridge's socket", seconds, lambda: [
            n[:-5] for n in os.listdir(d) if n.endswith(".sock") and not n.startswith(".") and n[:-5] not in exclude]
            if os.path.isdir(d) else None, every=0.02)
        self.session = found[0]
        return self.session


def user_line(text):
    return (json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n").encode()


class LineReader(threading.Thread):
    """Reads lines from a file object, stamping each with time.time() on arrival. Parses later."""

    def __init__(self, f, name):
        super().__init__(daemon=True, name=name)
        self.f = f
        self.lines = []      # (wall, raw bytes)
        self.done = threading.Event()

    def run(self):
        try:
            for line in iter(self.f.readline, b""):
                self.lines.append((time.time(), line))
        except (OSError, ValueError):
            pass
        self.done.set()


class Conn(http.client.HTTPConnection):
    def __init__(self, path, timeout=None):
        super().__init__("bridge", timeout=timeout)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class Subscriber(threading.Thread):
    """GET /events like the daemon's BridgeReader (http.client readline), reconnecting on end.
    Records (wall, raw line, subscription number); records each connect/snapshot time."""

    def __init__(self, path_fn, name="sub", reconnect=True, reconnect_sleep=0.0):
        super().__init__(daemon=True, name=name)
        self.path_fn = path_fn
        self.lines = []
        self.stop = threading.Event()
        self.subs = []        # (connect wall, first-line wall, snapshot bytes, status)
        self.ends = []        # wall times a stream ended
        self.reconnect = reconnect
        self.reconnect_sleep = reconnect_sleep
        self.conn = None

    def run(self):
        k = 0
        while not self.stop.is_set():
            t0 = time.time()
            try:
                c = self.conn = Conn(self.path_fn(), timeout=None)
                c.connect()
                self.sock = c.sock   # held: a Connection: close response takes it from `c`
                c.request("GET", "/events")
                r = c.getresponse()
                if r.status != 200:
                    self.subs.append((t0, time.time(), 0, r.status))
                    r.read()
                    c.close()
                    time.sleep(0.05)
                    continue
                first = True
                k += 1
                while True:
                    line = r.readline()
                    now = time.time()
                    if not line:
                        break
                    if first:
                        self.subs.append((t0, now, len(line), 200))
                        first = False
                    self.lines.append((now, line, k))
                self.ends.append(time.time())
                c.close()
            except (OSError, ValueError, http.client.HTTPException) as e:
                self.ends.append(time.time())
                if self.stop.is_set():
                    break
                time.sleep(0.02)
            if not self.reconnect:
                break
            if self.reconnect_sleep:
                time.sleep(self.reconnect_sleep)

    def close(self):
        self.stop.set()
        sock = getattr(self, "sock", None)
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def summary(xs, unit="ms"):
    if not xs:
        return "n=0"
    return "n=%d p50=%.2f p95=%.2f p99=%.2f max=%.2f mean=%.2f %s" % (
        len(xs), pct(xs, 50), pct(xs, 95), pct(xs, 99), max(xs), sum(xs) / len(xs), unit)


def stats(xs):
    if not xs:
        return {"n": 0}
    return {"n": len(xs), "p50": pct(xs, 50), "p95": pct(xs, 95), "p99": pct(xs, 99), "max": max(xs),
            "min": min(xs), "mean": sum(xs) / len(xs)}


def cpu_seconds(pid):
    """User+system CPU of a live process, from ps (centisecond resolution)."""
    r = subprocess.run(["ps", "-o", "time=", "-p", str(pid)], capture_output=True, text=True)
    s = r.stdout.strip()
    if not s:
        return None
    parts = s.split(":")
    secs = 0.0
    for p in parts:
        secs = secs * 60 + float(p)
    return secs


def child_pids(root_pid):
    r = subprocess.run(["pgrep", "-P", str(root_pid)], capture_output=True, text=True)
    return [int(x) for x in r.stdout.split()]


def find_bridge_child(session):
    r = subprocess.run(["pgrep", "-f", "sminos.py bridge --session %s" % session], capture_output=True, text=True)
    pids = [int(x) for x in r.stdout.split()]
    return pids
