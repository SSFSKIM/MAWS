// The listeners of condition 10, on loopback and on a non-loopback address of the host: an HTTP server, a WebSocket
// server, a raw TCP listener standing for a TURN server, a UDP listener (STUN, TURN over UDP, QUIC), and a raw TCP
// listener for preconnects. Every connection, request and packet is one JSON line in the log (and on stdout).
//
//   node listeners.mjs <log file> <ports file>
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

const [logFile, portsFile] = process.argv.slice(2);
const log = (entry) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(logFile, `${line}\n`);
  process.stdout.write(`${line}\n`);
};

const external = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const addresses = [['lo', '127.0.0.1'], ...(external ? [['ext', external]] : [])];
const listen = (server, address) => new Promise((resolve) => server.listen(0, address, () => resolve(server.address().port)));

const ports = [];
for (const [tag, address] of addresses) {
  const entry = { tag, address };
  const http = createServer((req, res) => {
    log({ listener: 'http', tag, method: req.method, url: req.url, from: req.socket.remoteAddress, origin: req.headers.origin ?? null, ua: (req.headers['user-agent'] ?? '').slice(0, 60) });
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url.endsWith('/eventsource')) { res.setHeader('Content-Type', 'text/event-stream'); res.end('data: hi\n\n'); return; }
    res.end('reached');
  });
  http.on('connection', (s) => log({ listener: 'http', tag, event: 'connection', from: s.remoteAddress }));
  entry.http = await listen(http, address);
  const wsHttp = createServer((req, res) => { log({ listener: 'ws', tag, method: req.method, url: req.url }); res.end('reached'); });
  wsHttp.on('connection', (s) => log({ listener: 'ws', tag, event: 'connection', from: s.remoteAddress }));
  const wss = new WebSocketServer({ server: wsHttp });
  wss.on('connection', (socket, req) => { log({ listener: 'ws', tag, event: 'upgrade', url: req.url, origin: req.headers.origin ?? null }); socket.close(); });
  entry.ws = await listen(wsHttp, address);
  const turn = createTcpServer((s) => {
    log({ listener: 'tcp-turn', tag, event: 'connection', from: s.remoteAddress });
    s.once('data', (d) => log({ listener: 'tcp-turn', tag, event: 'data', bytes: d.length, head: d.subarray(0, 20).toString('hex') }));
    s.on('error', () => {});
  });
  entry.tcp = await listen(turn, address);
  const pre = createTcpServer((s) => { log({ listener: 'tcp-preconnect', tag, event: 'connection', from: s.remoteAddress }); s.on('error', () => {}); });
  entry.preconnect = await listen(pre, address);
  const udp = createSocket('udp4');
  udp.on('message', (msg, rinfo) => log({ listener: 'udp', tag, event: 'packet', from: rinfo.address, bytes: msg.length, head: msg.subarray(0, 20).toString('hex') }));
  entry.udp = await new Promise((resolve) => udp.bind(0, address, () => resolve(udp.address().port)));
  ports.push(entry);
}
writeFileSync(portsFile, JSON.stringify(ports));
log({ listener: 'all', event: 'up', ports });
