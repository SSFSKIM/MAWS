"""Minimal interrupted-turn runs: python3 mini.py <run> <signal> [withwork]"""
import os, signal, sys, time
sys.path.insert(0, "/private/tmp/bg-handoff")
import scen
name = sys.argv[1]
sig = None if sys.argv[2] == "EXIT" else getattr(signal, sys.argv[2])
withwork = len(sys.argv) > 3
r = scen.Run(name)
r.start_session()
if withwork:
    task = os.path.join(r.e.w, "task.txt")
    ticker = 'for i in $(seq 1 777); do echo "tick $i $(date +%s)"; sleep 1; done; echo TICKER-END'
    with open(task, "w") as f:
        f.write("Start these now in one message, then reply STARTED. 1) Bash with run_in_background true, description ticker: "
                + ticker + " 2) Monitor with description monwatch, timeout_ms 1800000, command: tail -n0 -F "
                + os.path.join(r.e.w, "mon.txt") + "\n")
    r.state["ticks"] = 777
    r.e.type("Read %s and do exactly what it says." % task)
    r.wait_pane(r"STARTED", 120)
    time.sleep(2)
pid = r.e.pane_pid()
r.state["sid0"] = None
r.e.type("Without using any tools, write the numbers from 1 to 2000, one per line, nothing else.")
time.sleep(4.5)
r.snapshot("mid-stream")
r.e.type("/exit") if sig is None else os.kill(pid, sig)
r.log("%s sent to %d" % (sys.argv[2], pid))
time.sleep(4)
r.snapshot("after-signal")
r.log("tui alive %s" % r.e.alive(pid))
r.state["sid0"] = r.session_ids()[-1]
r.save()
