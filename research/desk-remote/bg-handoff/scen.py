"""Shared scenario steps: start an interactive session with live background work, snapshot the work's state.

Run state lives in <root>/state.json so phases can be run one Bash call at a time:
    python3 scen.py <run> <phase>
"""
import glob
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, "/private/tmp/bg-handoff")
import hb  # noqa: E402


def setup_prompt(w, ticks=420):
    ticker = 'for i in $(seq 1 %d); do echo "tick $i $(date +%%s)"; sleep 1; done; echo TICKER-END' % ticks
    return ((
        "Start these now, all in one message of tool calls, then reply with just STARTED. "
        "1) Bash with run_in_background true, description ticker: TICKERCMD "
        "2) Agent with run_in_background true, subagent_type general-purpose, description stepper, prompt: "
        "'Run the Bash command  sleep 1.9; date +%%s >> %s/stepper.log  50 times, one call at a time, each after the "
        "previous finished. Then run  echo STEPPER-DONE >> %s/stepper.log  and reply DONE.' "
        "3) Agent with run_in_background true, subagent_type general-purpose, description sleeper, prompt: "
        "'Run this Bash command in the foreground with timeout 600000 and wait for it: "
        "for i in $(seq 1 80); do date +%%s >> %s/sleeper.log; sleep 5; done   Then run  echo SLEEPER-DONE >> "
        "%s/sleeper.log  and reply DONE.' "
        "4) Monitor with description monwatch, timeout_ms 1800000, command: tail -n0 -F %s/mon.txt "
        "5) mcp__probe__slow with seconds 900 "
        "6) CronCreate with cron */30 * * * *, prompt 'Reply CRON-FIRED', recurring true."
    ) % (w, w, w, w, w)).replace("TICKERCMD", ticker)


FG_PROMPT = "Run this Bash command in the foreground (not in the background) with timeout 300000 and wait for it: for i in $(seq 1 150); do date +%%s >> %s/fg.log; sleep 1; done; echo FG-DONE   then reply FGDONE."


class Run:
    def __init__(self, name):
        self.e = hb.Env(name)
        self.statefile = os.path.join(self.e.root, "state.json")
        self.state = json.load(open(self.statefile)) if os.path.exists(self.statefile) else {}

    def save(self):
        with open(self.statefile, "w") as f:
            json.dump(self.state, f, indent=1)

    def log(self, msg):
        line = "%s %s" % (time.strftime("%H:%M:%S"), msg)
        print(line, flush=True)
        with open(os.path.join(self.e.out, "run.log"), "a") as f:
            f.write(line + "\n")

    # -- state readers

    def lines(self, name):
        p = os.path.join(self.e.w, name)
        return open(p).read().splitlines() if os.path.exists(p) else []

    def procs(self):
        return self.e.procs()

    def find(self, needle):
        return [p for p in self.e.procs() if needle in p["cmd"]]

    def ticker_pids(self):
        # the bash running the tick loop (its command line holds 'seq 1 420')
        n = self.state.get("ticks", 420)
        return [p["pid"] for p in self.e.procs(pattern="seq 1 %d); do echo" % n) if "bash" in p["cmd"] or "zsh" in p["cmd"]]

    def tail_pids(self):
        return [p["pid"] for p in self.e.procs(pattern="tail -n0 -F %s/mon.txt" % self.e.w) if p["cmd"].startswith("tail")]

    def sleeper_pids(self):
        return [p["pid"] for p in self.e.procs(pattern="%s/sleeper.log" % self.e.w) if "seq 1 80" in p["cmd"]]

    def fg_sleep_pids(self):
        return [p["pid"] for p in self.e.procs(pattern="%s/fg.log" % self.e.w) if "seq 1 150" in p["cmd"]]

    def mcp_pids(self):
        return [p["pid"] for p in self.e.procs(pattern="%s %s" % (hb.MCP, self.e.name))]

    def stdout_of(self, pid):
        r = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "1"], capture_output=True, text=True)
        rows = r.stdout.splitlines()[1:]
        return rows[0].split()[-1] if rows else None

    def snapshot(self, tag):
        tk = self.ticker_pids()
        out = self.stdout_of(tk[0]) if tk else None
        last_tick = None
        if out and os.path.exists(out):
            ls = [l for l in open(out, errors="replace").read().splitlines() if l.startswith("tick")]
            last_tick = ls[-1] if ls else None
        snap = dict(t=time.time(), ticker=tk, ticker_out=out, last_tick=last_tick, tail=self.tail_pids(),
                    sleeper=self.sleeper_pids(), fg_sleep=self.fg_sleep_pids(), mcp=self.mcp_pids(),
                    stepper_n=len(self.lines("stepper.log")), sleeper_n=len(self.lines("sleeper.log")), fg_n=len(self.lines("fg.log")),
                    stepper_last=(self.lines("stepper.log") or [None])[-1],
                    sleeper_last=(self.lines("sleeper.log") or [None])[-1])
        self.e.note("snapshot:" + tag, snap)
        self.log("snapshot %s: %s" % (tag, json.dumps(snap)))
        return snap

    def session_ids(self):
        return [os.path.basename(p)[:-6] for p in self.e.transcripts()]

    def transcript(self, sid):
        ps = glob.glob(os.path.join(self.e.cfg, "projects", "*", sid + ".jsonl"))
        return hb.records(ps[0]) if ps else []

    # -- interactive driving

    def wait_pane(self, pattern, seconds, window="p"):
        end = time.time() + seconds
        while time.time() < end:
            pane = self.e.pane(window)
            if re.search(pattern, pane):
                return pane
            time.sleep(0.5)
        return None

    def start_session(self, extra_env=None):
        self.e.setup(extra_env=extra_env)
        self.e.tui("--debug-file %s" % os.path.join(self.e.root, "debug-tui.txt"), extra_env=None)
        pane = self.wait_pane(r"\? for shortcuts|❯", 60)
        self.log("tui ready: %s" % bool(pane))

    def start_work(self, ticks=420):
        self.state["ticks"] = ticks
        self.save()
        task = os.path.join(self.e.w, "task.txt")
        with open(task, "w") as f:
            f.write(setup_prompt(self.e.w, ticks) + "\n")
        self.e.type("Read %s and do exactly what it says." % task)
        self.log("setup prompt sent")
        ok = self.wait_pane(r"STARTED", 180)
        self.log("STARTED seen: %s" % bool(ok))
        end = time.time() + 90
        while time.time() < end:
            if self.ticker_pids() and self.tail_pids() and self.lines("stepper.log") and self.lines("sleeper.log"):
                break
            time.sleep(1)
        self.state["sid0"] = self.session_ids()[-1] if self.session_ids() else None
        self.state["tui_pid"] = self.e.pane_pid()
        self.save()
        return self.snapshot("work-started")

    def start_fg_turn(self):
        self.e.type(FG_PROMPT % self.e.w)
        end = time.time() + 60
        while time.time() < end and not self.fg_sleep_pids():
            time.sleep(0.5)
        self.log("fg sleep running: %s" % self.fg_sleep_pids())
        return self.snapshot("fg-turn-in-flight")


if __name__ == "__main__":
    r = Run(sys.argv[1])
    getattr(r, sys.argv[2])()
