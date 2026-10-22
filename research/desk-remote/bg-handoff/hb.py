"""Isolated Claude Code sessions for the background-work handoff probe.

Isolation follows sminos tests/mods/live-bridge-check.py and /private/tmp/cmd-probe/harness.py:
a temporary HOME whose .claude is CLAUDE_CONFIG_DIR, its own tmux server (-L), the gateway keys
passed through a 0600 env file, nothing else of the caller's environment. settings.json pins
daemonColdStart "transient" so no launchd service is installed (its label is per user).
"""
import glob
import hashlib
import json
import os
import shlex
import signal
import subprocess
import threading
import time

VERSION = "2.1.307"
CLAUDE = "/Users/new/.local/share/claude/versions/" + VERSION
BASE = "/private/tmp/bg-handoff"
MCP = BASE + "/mcp_slow_server.py"
GATEWAY_KEYS = ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY")
BASE_KEYS = ("TERM", "LANG", "USER", "LOGNAME", "SHELL", "TMPDIR")
SETTINGS = {
    "permissions": {"allow": ["Bash", "Monitor", "Agent", "Read", "Write", "Edit", "SendMessage", "Task", "CronCreate", "CronList", "CronDelete",
                              "mcp__probe__slow", "mcp__probe__ping"]},
    "modelSettings": {"claude-haiku-5-5": {"effortLevel": "low"}},
    "daemonColdStart": "transient",
}


def clean_path():
    return ":".join(p for p in os.environ.get("PATH", "").split(":") if "cmux-cli-shims" not in p)


class Env:
    def __init__(self, name):
        self.name = name
        self.root = os.path.join(BASE, name)
        self.home = os.path.join(self.root, "home")
        self.cfg = os.path.join(self.home, ".claude")
        self.work = os.path.join(self.root, "work")
        self.w = os.path.join(self.root, "w")          # files the background work writes
        self.out = os.path.join(self.root, "out")      # raw headless output, notes
        self.envfile = os.path.join(self.root, "env")
        self.mcplog = os.path.join(self.root, "mcp.log")
        self.tmux = ["tmux", "-L", "bgh-" + name, "-f", "/dev/null"]

    # -- setup

    def setup(self, settings=None, extra_env=None):
        for d in (self.cfg, self.work, self.w, self.out):
            os.makedirs(d)
        trusted = {"hasTrustDialogAccepted": True}
        cfg = {"hasCompletedOnboarding": True, "theme": "dark",
               "projects": {self.work: trusted, os.path.realpath(self.work): trusted},
               "mcpServers": {"probe": {"type": "stdio", "command": "/usr/bin/python3",
                                        "args": ["-I", MCP, self.name],
                                        "env": {"PROBE_MCP_LOG": self.mcplog}}}}
        # Mirror the owner's feature-gate cache (read only), so gated tools such as Monitor match their sessions.
        owner = json.load(open(os.path.expanduser("~/.claude.json")))
        for k in ("cachedGrowthBookFeatures", "cachedGrowthBookFeaturesAt"):
            if k in owner:
                cfg[k] = owner[k]
        with open(os.path.join(self.cfg, ".claude.json"), "w") as f:
            json.dump(cfg, f)
        s = dict(SETTINGS)
        s.update(settings or {})
        with open(os.path.join(self.cfg, "settings.json"), "w") as f:
            json.dump(s, f, indent=1)
        subprocess.run(["git", "-c", "init.defaultBranch=main", "init", "-q", self.work], check=True)
        with open(os.path.join(self.work, "README.txt"), "w") as f:
            f.write("probe work dir\n")
        subprocess.run(["git", "-C", self.work, "add", "."], check=True)
        subprocess.run(["git", "-C", self.work, "-c", "user.name=p", "-c", "user.email=p@x", "commit", "-qm", "init"],
                       check=True)
        env = {k: os.environ[k] for k in BASE_KEYS if k in os.environ}
        env.update(PATH=clean_path(), HOME=self.home, CLAUDE_CONFIG_DIR=self.cfg, DISABLE_AUTOUPDATER="1",
                   CLAUDE_CODE_SUBAGENT_MODEL="haiku", CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS="10000", CLAUDE_CODE_DEBUG_LOGS_DIR=os.path.join(self.root, "debug-env.txt"))
        env.update({k: os.environ[k] for k in GATEWAY_KEYS})
        env.update(extra_env or {})
        fd = os.open(self.envfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            for k, v in sorted(env.items()):
                f.write("export %s=%s\n" % (k, shlex.quote(v)))

    def shell(self, argv_str, cwd=None, extra_env=None):
        """A command line run under the isolated env (env -i + the 0600 env file)."""
        pre = "".join("export %s=%s; " % (k, shlex.quote(v)) for k, v in (extra_env or {}).items())
        inner = "set -e; . %s; %scd %s; exec %s" % (shlex.quote(self.envfile), pre, shlex.quote(cwd or self.work),
                                                   argv_str)
        return "env -i /bin/bash --noprofile --norc -c %s" % shlex.quote(inner)

    # -- interactive

    def tui(self, extra="", window="p", cols=200, rows=50, extra_env=None):
        cmd = self.shell("%s --model haiku --permission-mode default %s" % (CLAUDE, extra), extra_env=extra_env)
        subprocess.run(self.tmux + ["new-session", "-d", "-s", window, "-x", str(cols), "-y", str(rows), cmd],
                       check=True)

    def window(self, name, argv_str, cols=200, rows=50, extra_env=None):
        cmd = self.shell(argv_str, extra_env=extra_env)
        subprocess.run(self.tmux + ["new-session", "-d", "-s", name, "-x", str(cols), "-y", str(rows), cmd],
                       check=True)

    def pane(self, window="p", history=False):
        args = ["capture-pane", "-p", "-t", window] + (["-S", "-300"] if history else [])
        return subprocess.run(self.tmux + args, capture_output=True, text=True).stdout

    def pane_pid(self, window="p"):
        r = subprocess.run(self.tmux + ["display-message", "-p", "-t", window, "#{pane_pid}"], capture_output=True,
                           text=True)
        return int(r.stdout.strip()) if r.stdout.strip() else None

    def keys(self, *keys, window="p"):
        subprocess.run(self.tmux + ["send-keys", "-t", window] + list(keys), check=True)

    def type(self, text, enter=True, window="p"):
        self.keys("-l", text, window=window)
        if enter:
            time.sleep(0.5)
            self.keys("Enter", window=window)

    def kill_tmux(self):
        subprocess.run(self.tmux + ["kill-server"], capture_output=True)

    # -- headless

    def headless(self, args, tag, extra_env=None):
        """claude -p stream-json in/out. Every stdout line is appended to out/<tag>.jsonl stamped with arrival time;
        stderr goes to out/<tag>.err."""
        argv = "%s -p --input-format stream-json --output-format stream-json --verbose --model haiku %s" % (
            CLAUDE, " ".join(shlex.quote(a) for a in args))
        err = open(os.path.join(self.out, tag + ".err"), "ab")
        p = subprocess.Popen(["/bin/bash", "-c", self.shell(argv, extra_env=extra_env)], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=err, bufsize=0)
        path = os.path.join(self.out, tag + ".jsonl")

        def pump():
            with open(path, "ab") as f:
                for line in iter(p.stdout.readline, b""):
                    f.write(json.dumps({"t": time.time()}).encode()[:-1] + b', "line": ' +
                            json.dumps(line.decode("utf-8", "replace").rstrip("\n")).encode() + b"}\n")
                    f.flush()
        threading.Thread(target=pump, daemon=True).start()
        return p

    @staticmethod
    def send(p, text):
        p.stdin.write((json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n").encode())
        p.stdin.flush()

    # -- CLI verbs, state

    def cli(self, args, timeout=60, extra_env=None):
        r = subprocess.run(["/bin/bash", "-c", self.shell("%s %s" % (CLAUDE, args), extra_env=extra_env)],
                           capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr

    def transcripts(self):
        return sorted(glob.glob(os.path.join(self.cfg, "projects", "*", "*.jsonl")), key=os.path.getmtime)

    def jobs(self):
        return sorted(glob.glob(os.path.join(self.cfg, "jobs", "*", "state.json")), key=os.path.getmtime)

    def sock_root(self):
        h = hashlib.sha256(os.path.abspath(self.cfg).encode()).hexdigest()[:8]
        return "/tmp/cc-daemon-%d/%s" % (os.getuid(), h)

    def procs(self, pattern=None):
        """Processes whose command line mentions this run's root (or `pattern`): pid, ppid, pgid, etime, command."""
        r = subprocess.run(["ps", "-axo", "pid=,ppid=,pgid=,etime=,command="], capture_output=True, text=True)
        out = []
        for line in r.stdout.splitlines():
            if (pattern or self.root) in line and "ps -axo" not in line:
                parts = line.split(None, 4)
                out.append(dict(pid=int(parts[0]), ppid=int(parts[1]), pgid=int(parts[2]), etime=parts[3],
                                cmd=parts[4]))
        return out

    def alive(self, pid):
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    def note(self, tag, obj):
        with open(os.path.join(self.out, "notes.jsonl"), "a") as f:
            f.write(json.dumps({"t": time.time(), "tag": tag, "v": obj}) + "\n")


def tail_lines(path, n=5):
    try:
        with open(path) as f:
            return f.read().splitlines()[-n:]
    except OSError as e:
        return ["<%s>" % e]


def records(path):
    out = []
    with open(path) as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out
