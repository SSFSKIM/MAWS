#!/usr/bin/env python3
"""One project's log on this machine, writer by writer, for `deployment counts`
(the composite's Parent-Level Acceptance 10: the counts of events per writer
agree between each machine's log files and the hub).

Read-only, and standard library only, so it runs on a machine with no MAWS
checkout (`ssh mini python3 - … < machine-counts.py`). It reads the log files
under $SMINOS_HOME/projects/<id>/log/, the positions the machine refused on
import (`spent` in the project's uplink.json), and from
$SMINOS_HOME/daemon/hub.json the machine's enrolled name and its former names
(the keys of `former`, the names the installation wrote under before it
enrolled): those names alone, nothing else of that file is kept or printed. It
runs no sminos command, since every sminos verb may migrate state first.

    python3 machine-counts.py --dir <a checkout of the project> > sk.json
    ssh mini python3 - --dir <the checkout there> < machine-counts.py > mini.json

Per writer: the count, the last seq, the seqs missing below it, the seqs held
twice, a fingerprint (SHA-256 over "<seq>\\t<kind>\\t<ts>\\n" in seq order), and
the rows themselves ([seq, kind, ts] in seq order), computed as counts.ts
computes the hub's. A line that is not an event (not JSON, or without a writer
and an integer seq) is damage: the snapshot is still written, naming each such
line under `unreadable`, and the script names them on stderr and exits 1.
"""
import argparse
import datetime
import glob
import hashlib
import json
import os
import sys


def sminos_home(arg):
    if arg:
        return os.path.expanduser(arg)
    return os.environ.get("SMINOS_HOME") or os.environ.get("DAEMON_HOME") or os.path.expanduser("~/.claude/sminos")


def project_of(directory):
    """The id in the first .smns above `directory`."""
    d = os.path.abspath(os.path.expanduser(directory))
    while True:
        path = os.path.join(d, ".smns")
        if os.path.isfile(path):
            with open(path) as f:
                smns = json.load(f)
            pid = smns.get("project") if isinstance(smns, dict) else None
            if not isinstance(pid, str) or not pid:
                sys.exit("%s names no project id" % path)
            return pid
        parent = os.path.dirname(d)
        if parent == d:
            sys.exit("no .smns above %s: pass --project <id>" % directory)
        d = parent


def enrollment(home):
    """The enrolled name and the former names (hub.json's `machine` and the keys of its `former`)."""
    try:
        with open(os.path.join(home, "daemon", "hub.json")) as f:
            held = json.load(f)
    except (OSError, ValueError):
        return None, []
    if not isinstance(held, dict):
        return None, []
    name, former = held.get("machine"), held.get("former")
    return (name if isinstance(name, str) and name else None,
            sorted(n for n in former if isinstance(n, str) and n) if isinstance(former, dict) else [])


def count_writers(events):
    by = {}
    for at, e in enumerate(events):
        writer, seq = e.get("writer"), e.get("seq")
        if not isinstance(writer, str) or isinstance(seq, bool) or not isinstance(seq, int):
            continue
        kind = e.get("kind") if isinstance(e.get("kind"), str) else ""
        ts = e.get("ts") if isinstance(e.get("ts"), str) else ""
        by.setdefault(writer, []).append((seq, at, kind, ts))
    out = {}
    for writer in sorted(by):
        rows = sorted(by[writer])
        seen = {}
        for seq, _, _, _ in rows:
            seen[seq] = seen.get(seq, 0) + 1
        last = rows[-1][0] if rows else 0
        digest = hashlib.sha256()
        for seq, _, kind, ts in rows:
            digest.update(("%d\t%s\t%s\n" % (seq, kind, ts)).encode("utf-8"))
        out[writer] = {
            "count": len(rows),
            "last": last,
            "holes": [s for s in range(1, last + 1) if s not in seen],
            "repeats": sorted(s for s, n in seen.items() if n > 1),
            "fingerprint": digest.hexdigest(),
            "rows": [[seq, kind, ts] for seq, _, kind, ts in rows],
        }
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--project", help="the .smns project id (default: the .smns above --dir)")
    p.add_argument("--dir", default=".", help="a checkout of the project (default: the working directory)")
    p.add_argument("--home", help="SMINOS_HOME (default: $SMINOS_HOME, else ~/.claude/sminos)")
    p.add_argument("--side", help="this snapshot's label (default: the enrolled machine name)")
    args = p.parse_args()
    home = sminos_home(args.home)
    pid = args.project or project_of(args.dir)
    log_dir = os.path.join(home, "projects", pid, "log")
    if not os.path.isdir(log_dir):
        sys.exit("no log at %s: is the project known on this machine?" % log_dir)
    events, unreadable = [], []
    for path in sorted(glob.glob(os.path.join(glob.escape(log_dir), "*.jsonl"))):
        with open(path, "rb") as f:
            for n, line in enumerate(f, 1):
                if not line.strip():
                    continue
                try:
                    e = json.loads(line.decode("utf-8"))
                except ValueError:
                    e = None
                if not (isinstance(e, dict) and isinstance(e.get("writer"), str)
                        and type(e.get("seq")) is int):
                    unreadable.append("%s:%d" % (os.path.basename(path), n))
                    continue
                events.append(e)
    machine, former = enrollment(home)
    # The positions this machine refused on import and skipped past (uplink.json's `spent`, sminos_hublog.py): a hole
    # one leaves is the refusal's, not a loss. Nothing else of uplink.json is read.
    spent = {}
    try:
        with open(os.path.join(home, "projects", pid, "uplink.json")) as f:
            raw = json.load(f).get("spent")
        if isinstance(raw, dict):
            spent = {w: sorted(s for s in ss if type(s) is int) for w, ss in raw.items() if isinstance(ss, list)}
    except (OSError, ValueError, AttributeError):
        pass
    snapshot = {
        "v": 2,
        "side": args.side or machine or os.uname().nodename,
        "project": pid,
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "machine": machine,
        "former": former,
        "log": log_dir,
        "writers": count_writers(events),
        "spent": spent,
    }
    if unreadable:
        snapshot["unreadable"] = unreadable
    json.dump(snapshot, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    if unreadable:
        # Written all the same, so counts.ts names the damage beside the rest; a damaged log never agrees.
        sys.exit("%d line(s) of %s are not events: %s" % (len(unreadable), log_dir, ", ".join(unreadable)))


if __name__ == "__main__":
    main()
