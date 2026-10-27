#!/usr/bin/env python3
"""Stdio MCP server for the handoff probe: `ping` and `slow` (sleeps `seconds`, then answers).
Logs start/exit/each request with its pid, and each slow call's start and finish."""
import json
import os
import sys
import threading
import time

LOG = os.environ.get("PROBE_MCP_LOG", "/private/tmp/bg-handoff/mcp.log")
lock = threading.Lock()


def log(msg):
    with open(LOG, "a") as f:
        f.write("%.3f pid=%d ppid=%d %s\n" % (time.time(), os.getpid(), os.getppid(), msg))


def send(obj):
    with lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def slow(mid, seconds):
    log("slow start id=%s seconds=%s" % (mid, seconds))
    time.sleep(seconds)
    log("slow done id=%s" % mid)
    send({"jsonrpc": "2.0", "id": mid, "result": {
        "content": [{"type": "text", "text": "slow finished after %ss pid=%d" % (seconds, os.getpid())}],
        "isError": False}})


log("start")
try:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        method, mid = msg.get("method"), msg.get("id")
        log("recv %s id=%s" % (method, mid))
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "probe", "version": "0.1.0"}}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [
                {"name": "ping", "description": "Answers pong with this server's pid.",
                 "inputSchema": {"type": "object", "properties": {}}},
                {"name": "slow", "description": "Sleeps for `seconds` seconds, then answers.",
                 "inputSchema": {"type": "object", "properties": {"seconds": {"type": "number"}},
                                 "required": ["seconds"]}}]}})
        elif method == "tools/call":
            p = msg.get("params", {})
            if p.get("name") == "slow":
                secs = float(p.get("arguments", {}).get("seconds", 60))
                threading.Thread(target=slow, args=(mid, secs), daemon=True).start()
            else:
                send({"jsonrpc": "2.0", "id": mid, "result": {
                    "content": [{"type": "text", "text": "pong pid=%d" % os.getpid()}], "isError": False}})
        elif mid is not None:
            if method == "ping":
                send({"jsonrpc": "2.0", "id": mid, "result": {}})
            else:
                send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "no method %s" % method}})
finally:
    log("exit")
