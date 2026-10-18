// P3-HD M2: a stand-in for an engine host that dies without closing (e2e/connectors-direct.spec.ts, "transport: host
// death"). It starts one stdio instance exactly as OwnedStdioTransport does (the plan, src/engine-host/connectors/
// direct-stdio.ts `stdioSpawnPlan`, arrives as JSON in argv[2]; the lifeline's group argument is the server's pid), prints
// both pids, holds the pipes, and waits to be killed. It never writes to the server or the lifeline.
//   node connector-direct-host.mjs '<{"server":{command,args,options},"lifeline":{command,args,options}}>'
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setInterval } from 'node:timers';

const plan = JSON.parse(process.argv[2]);
const server = spawn(plan.server.command, plan.server.args, plan.server.options);
server.stdout.on('data', () => {}); // drained, as the transport drains it
const args = [...plan.lifeline.args.slice(0, -1), String(server.pid)];
const lifeline = spawn(plan.lifeline.command, args, plan.lifeline.options);
process.stdout.write(`${JSON.stringify({ server: server.pid, lifeline: lifeline.pid })}\n`);
setInterval(() => {}, 60_000);
