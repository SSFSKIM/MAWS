#!/usr/bin/env python3
"""Trivial stdio MCP server for the probe: one tool `ping`. Logs start/exit/each request with its pid."""
import json
import os
import sys
import time

LOG = os.environ.get("PROBE_MCP_LOG", "/private/tmp/cmd-probe/mcp.log")


def log(msg):
    with open(LOG, "a") as f:
        f.write("%.3f pid=%d %s\n" % (time.time(), os.getpid(), msg))


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


log("start")
try:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        method, mid = msg.get("method"), msg.get("id")
        log("recv %s" % method)
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "probe", "version": "0.1.0"}}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [{
                "name": "ping", "description": "Answers pong with this server's pid.",
                "inputSchema": {"type": "object", "properties": {}}}]}})
        elif method == "tools/call":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": "pong pid=%d" % os.getpid()}], "isError": False}})
        elif mid is not None:
            if method == "ping":
                send({"jsonrpc": "2.0", "id": mid, "result": {}})
            else:
                send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "no method %s" % method}})
finally:
    log("exit")
