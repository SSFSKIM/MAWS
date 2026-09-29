// W2-1g: separate the candidate trust rules. listApps and ping only; no GUI action.
// Signatures: OPENAI_NODE team 2DC432GLL2 id node; NVM_NODE team HX7739G8FX (Node.js Foundation) id node;
// BREW_NODE ad-hoc; PSF_PY team BMM5U3QVKW (Python Software Foundation); /bin/sh Apple platform binary.
import {run,root} from './mcp-client.mjs';
import {cuaRepl} from './cua-env.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const base=cuaRepl();
const OPENAI_NODE=base.command, NVM_NODE=process.execPath, BREW_NODE='/opt/homebrew/bin/node', PSF_PY='/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12';
const banner=readFileSync('/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/@oai/cua-repl/instructions/banner.js','utf8');
const env={...base.env,NODE_REPL_JS_BANNER:banner,NODE_REPL_UNTRUSTED_ENV_ALLOWLIST:'CUA_REPL_ENABLED_SURFACES,CUA_REPL_BROWSER_ENV'};
const results=[];
const relay=async(label,command,args,extra={})=>run('w2-disc-'+label,async p=>{
 await p.init();const r=await p.callTool('js',{title:'listApps',code:'const apps = await cua.listApps({emit:false}); nodeRepl.write(`apps=${apps.length}`);'});
 const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join(' ');const ok=/apps=\d+/.test(text);
 const chain=p.tree('chain').slice(0,4).map(x=>x.command.split(' ')[0]);results.push({label,ok,chain,tail:text.slice(-160)});console.log(label,ok?'ACCEPTED':'REJECTED',chain.join(' → '));
},{command,args,env:{...env,...extra},capabilities:{elicitation:{form:{}}}});
const direct=(label,cmd,args)=>{const out=execFileSync(cmd,args,{encoding:'utf8'}).trim();results.push({label,out});console.log(label,out);};
// Relay path: what may sit between node_repl and a trusted ancestor?
await relay('openai-node__brew-adhoc-node__node_repl',OPENAI_NODE,[root+'hop-launcher.mjs'],{HOP_EXEC_1:BREW_NODE});
await relay('openai-node__sh__node_repl',OPENAI_NODE,[root+'sh-hop.mjs']);
await relay('brew-adhoc-node__node_repl',BREW_NODE,[root+'hop-launcher.mjs']);
// Repeat the original pair, alternating, to rule out ordering and timing effects.
for (let i=0;i<2;i++){await relay(`nvm-node__node_repl#${i}`,NVM_NODE,[root+'hop-launcher.mjs']);await relay(`openai-node__node_repl#${i}`,OPENAI_NODE,[root+'hop-launcher.mjs']);}
// Direct socket clients: is the sender itself checked, and is a trusted ancestor enough?
direct('sender=openai-node (no OpenAI ancestor)',OPENAI_NODE,[root+'sock-client.mjs']);
direct('sender=nvm-node (no OpenAI ancestor)',NVM_NODE,[root+'sock-client.mjs']);
direct('sender=nvm-node under openai-node',OPENAI_NODE,[root+'run-under.mjs','--',NVM_NODE,root+'sock-client.mjs']);
direct('sender=brew-adhoc-node under openai-node',OPENAI_NODE,[root+'run-under.mjs','--',BREW_NODE,root+'sock-client.mjs']);
direct('sender=psf-python under openai-node',OPENAI_NODE,[root+'run-under.mjs','--',PSF_PY,root+'raw-socket-ping.py']);
writeFileSync(root+'fixtures/w2-auth-discriminate.json',JSON.stringify(results,null,1));
