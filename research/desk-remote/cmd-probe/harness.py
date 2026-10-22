"""Isolated Claude Code session in its own tmux server, driven through the cmdprobe mod's file bus.

Isolation follows sminos tests/mods/live-bridge-check.py: temp HOME whose .claude is the config dir,
own tmux server (-L), gateway keys passed in a 0600 env file, nothing else of the caller's env.
"""
import glob
import hashlib
import json
import os
import shlex
import subprocess
import time

CLAUDE = "/Users/new/.local/share/claude/versions/2.1.307"
PLUGIN = "/private/tmp/cmd-probe/plugin/cmdprobe"
MCP = "/private/tmp/cmd-probe/mcp_probe_server.py"
GATEWAY_KEYS = ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY")
BASE_KEYS = ("TERM", "LANG", "USER", "LOGNAME", "SHELL", "TMPDIR")


def clean_path():
    return ":".join(p for p in os.environ.get("PATH", "").split(":") if "cmux-cli-shims" not in p)


class Env:
    def __init__(self, name, settings=None):
        self.name = name
        self.root = "/private/tmp/cmd-probe/" + name
        self.home = os.path.join(self.root, "home")
        self.cfg = os.path.join(self.home, ".claude")
        self.work = os.path.join(self.root, "work")
        self.bus = os.path.join(self.root, "bus")
        self.envfile = os.path.join(self.root, "env")
        self.mcplog = os.path.join(self.root, "mcp.log")
        self.tmux = ["tmux", "-L", "cmdprobe-" + name, "-f", "/dev/null"]
        self.settings = settings or {}
        self.n = 0
        self.t_last_input = 0.0

    # -- setup

    def setup(self):
        os.makedirs(self.cfg)
        os.makedirs(os.path.join(self.bus, "events"))
        os.makedirs(self.work)
        trusted = {"hasTrustDialogAccepted": True}
        with open(os.path.join(self.cfg, ".claude.json"), "w") as f:
            json.dump({"hasCompletedOnboarding": True, "theme": "dark",
                       "projects": {self.work: trusted, os.path.realpath(self.work): trusted},
                       "mcpServers": {"probe": {"type": "stdio", "command": "/usr/bin/python3",
                                                "args": ["-I", MCP, self.name],
                                                "env": {"PROBE_MCP_LOG": self.mcplog}}}}, f)
        with open(os.path.join(self.cfg, "settings.json"), "w") as f:
            json.dump(self.settings, f)
        subprocess.run(["git", "-c", "init.defaultBranch=main", "init", "-q", self.work], check=True)
        with open(os.path.join(self.work, "README.txt"), "w") as f:
            f.write("probe work dir\n")
        subprocess.run(["git", "-C", self.work, "add", "."], check=True)
        subprocess.run(["git", "-C", self.work, "-c", "user.name=p", "-c", "user.email=p@x", "commit", "-qm", "init"],
                       check=True)
        env = {k: os.environ[k] for k in BASE_KEYS if k in os.environ}
        env.update(PATH=clean_path(), HOME=self.home, CLAUDE_CONFIG_DIR=self.cfg,
                   CLAUDE_CODE_ENABLE_FUNCTION_HOOKS="1", CMDPROBE_BUS=self.bus, DISABLE_AUTOUPDATER="1")
        env.update({k: os.environ[k] for k in GATEWAY_KEYS})
        fd = os.open(self.envfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            for k, v in sorted(env.items()):
                f.write("export %s=%s\n" % (k, shlex.quote(v)))

    def shell(self, argv_str, cwd=None):
        """A command line run under the isolated env (env -i + the 0600 env file)."""
        inner = "set -e; . %s; cd %s; exec %s" % (shlex.quote(self.envfile), shlex.quote(cwd or self.work), argv_str)
        return "env -i /bin/bash --noprofile --norc -c %s" % shlex.quote(inner)

    def start(self, extra="", window="p", cols=200, rows=50):
        cmd = self.shell("%s --plugin-dir %s --model haiku --permission-mode default %s" % (
            CLAUDE, shlex.quote(PLUGIN), extra))
        subprocess.run(self.tmux + ["new-session", "-d", "-s", window, "-x", str(cols), "-y", str(rows), cmd],
                       check=True)

    def kill(self):
        subprocess.run(self.tmux + ["kill-server"], capture_output=True)

    # -- terminal

    def pane(self, window="p", history=False):
        args = ["capture-pane", "-p", "-t", window] + (["-S", "-200"] if history else [])
        return subprocess.run(self.tmux + args, capture_output=True, text=True).stdout

    def keys(self, *keys, window="p"):
        subprocess.run(self.tmux + ["send-keys", "-t", window] + list(keys), check=True)
        self.t_last_input = time.time()

    def type(self, text, enter=True, window="p"):
        self.keys("-l", text, window=window)
        if enter:
            time.sleep(0.4)
            self.keys("Enter", window=window)

    # -- the bus

    def req(self, op, **kw):
        self.n += 1
        rid = "%04d" % self.n
        tmp = os.path.join(self.bus, ".%s.tmp" % rid)
        with open(tmp, "w") as f:
            json.dump(dict(op=op, **kw), f)
        os.rename(tmp, os.path.join(self.bus, "%s.req.json" % rid))
        return rid

    def ack(self, rid):
        p = os.path.join(self.bus, "%s.ack.json" % rid)
        return json.load(open(p)) if os.path.exists(p) else None

    def res(self, rid):
        p = os.path.join(self.bus, "%s.res.json" % rid)
        if not os.path.exists(p):
            return None
        try:
            return json.load(open(p))
        except ValueError:
            return None

    def wait(self, rid, timeout=20.0):
        end = time.time() + timeout
        while time.time() < end:
            r = self.res(rid)
            if r is not None:
                return r
            time.sleep(0.1)
        return None

    def call(self, op, timeout=20.0, **kw):
        return self.wait(self.req(op, **kw), timeout)

    def events(self, since=0.0):
        out = []
        for p in glob.glob(os.path.join(self.bus, "events", "*.json")):
            try:
                e = json.load(open(p))
            except ValueError:
                continue
            if e.get("t", 0) / 1000.0 >= since:
                out.append(e)
        return sorted(out, key=lambda e: e["t"])

    # -- independent state

    def transcripts(self):
        return sorted(glob.glob(os.path.join(self.cfg, "projects", "*", "*.jsonl")), key=os.path.getmtime)

    def mcp_log(self):
        return open(self.mcplog).read() if os.path.exists(self.mcplog) else ""

    def mcp_pids(self):
        r = subprocess.run(["pgrep", "-f", "%s %s$" % (MCP, self.name)], capture_output=True, text=True)
        return [int(x) for x in r.stdout.split()]

    def sock_root(self):
        h = hashlib.sha256(os.path.abspath(self.cfg).encode()).hexdigest()[:8]
        return "/tmp/cc-daemon-%d/%s" % (os.getuid(), h)
