# Unsigned, non-OpenAI peer: connect to the computer-use socket and send ping, then a ListApps request.
# Isolates the service's peer authentication from everything above it.
import json, os, socket, struct, sys, time
path = os.path.expanduser('~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock')
out = []
def frame(obj):
    b = json.dumps(obj).encode()
    return struct.pack('<I', len(b)) + b
def read_one(s, timeout=5):
    s.settimeout(timeout)
    buf = b''
    while len(buf) < 4:
        chunk = s.recv(4 - len(buf))
        if not chunk: return {'closed': True, 'partial': buf.hex()}
        buf += chunk
    n = struct.unpack('<I', buf)[0]
    body = b''
    while len(body) < n:
        chunk = s.recv(n - len(body))
        if not chunk: return {'closed': True, 'partial_body': body[:200].decode(errors='replace')}
        body += chunk
    return json.loads(body)
def attempt(label, messages):
    rec = {'label': label, 'at': time.time()}
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.connect(path); rec['connected'] = True
    except Exception as e:
        rec['connect_error'] = repr(e); out.append(rec); return
    rec['exchanges'] = []
    for m in messages:
        try:
            s.sendall(frame(m)); rec['exchanges'].append({'sent': m, 'got': read_one(s)})
        except Exception as e:
            rec['exchanges'].append({'sent': m, 'error': repr(e)}); break
    s.close(); out.append(rec)
attempt('ping-v5-then-listapps', [
    {'jsonrpc': '2.0', 'id': 1, 'method': 'ping', 'params': {'clientApiVersion': 'CodexComputerUseIPC-5'}},
    {'jsonrpc': '2.0', 'id': 2, 'method': 'request', 'params': {'clientApiVersion': 'CodexComputerUseIPC-5', 'deadlineUnixMilliseconds': int(time.time()*1000) + 10000, 'request': {}, 'requestType': 'ComputerUseIPCListAppsRequest'}},
])
attempt('ping-v4', [{'jsonrpc': '2.0', 'id': 1, 'method': 'ping', 'params': {'clientApiVersion': 'CodexComputerUseIPC-4'}}])
json.dump(out, sys.stdout, indent=1)
