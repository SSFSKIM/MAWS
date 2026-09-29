// W3-0: the shim under the neutral client. The client sends what Claude Code sends: bare `elicitation:{}`,
// `_meta:{"claudecode/toolUseId"}` on calls, and `{action, content}` replies. TextEdit only; every other approval declined.
import {run,root} from './mcp-client.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
const HOME='/tmp/maws-cu-probe/shim-home', DOC='/tmp/maws-cu-probe/textedit-probe.txt';
writeFileSync(DOC,'MAWS shim unit test.\n');execFileSync('open',['-g','-a','TextEdit',DOC]);await new Promise(r=>setTimeout(r,2500));
await run('w3-shim-unit',async p=>{
 let asks=0;p.on('elicitation/create',params=>{asks++;const ok=/TextEdit/.test(params.message);p.note({event:'elicitation',accept:ok,message:params.message,hasMeta:'_meta' in params});return ok?{action:'accept',content:{}}:{action:'decline'};});
 const init=await p.init();const tools=await p.request('tools/list',{});
 console.log('tools:',tools.tools.map(t=>`${t.name}${t._meta?.['anthropic/alwaysLoad']?'[alwaysLoad]':''}${t._meta?.ui?'[ui:'+JSON.stringify(t._meta.ui.visibility)+']':''}`).join(' '));
 const js=async(title,code)=>{const a0=asks;const r=await p.callTool('js',{title,code,timeout_ms:60000},{meta:{'claudecode/toolUseId':'toolu_'+title.replace(/\W/g,'_')}});
  console.log('##',title,'| isError',!!r.isError,'| asks',asks-a0,'| items',r.content.map(c=>c.type+(c.mimeType?':'+c.mimeType:'')).join(','),'|',r.content.filter(c=>c.type==='text').map(c=>c.text).join(' ').replace(/\s+/g,' ').slice(-140));return r;};
 await js('bind','globalThis.app = await cua.getApp("TextEdit");');
 await js('state and shot','const s = await app.getAXStateAndScreenshot({disableDiffing:true}); nodeRepl.write(`bytes=${s.screenshot?.length}`);');
 await js('quit','await app.pressKey("super+q");');
},{command:process.execPath,args:[root+'../../plugins/cua/cua-shim.mjs'],env:{CUA_SHIM_CODEX_HOME:HOME,CUA_SHIM_LOG:root+'fixtures/w3-shim-unit.shim.jsonl',CUA_SHIM_SESSION_ID:'shim-unit-s1'},capabilities:{elicitation:{}}});
console.log('approvals written:',existsSync(HOME+'/computer-use/sessions')?readdirSync(HOME+'/computer-use/sessions').map(f=>f+' → '+readFileSync(HOME+'/computer-use/sessions/'+f,'utf8').trim()):'none');
console.log('TextEdit running:',execFileSync('osascript',['-e','tell application "System Events" to (name of processes whose name is "TextEdit")'],{encoding:'utf8'}).trim()||'no');
