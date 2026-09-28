// W2-2b: actions in the throwaway TextEdit document, with Codex-shaped turn metadata so session approval can persist.
// Tests AX-index click, typing, coordinate space (screenshot pixels vs points), setValue, diff output, focus and cursor.
import {run} from './mcp-client.mjs';
import {cuaRepl,SCRATCH} from './cua-env.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
const DOC=SCRATCH+'/textedit-probe.txt';
const sh=(cmd,args)=>{try{return execFileSync(cmd,args,{encoding:'utf8'}).trim();}catch(e){return 'ERR '+e.message.split('\n')[0];}};
const observe=()=>({frontmost:sh('osascript',['-e','tell application "System Events" to name of first application process whose frontmost is true']),
 mouse:sh('osascript',['-l','JavaScript','-e','ObjC.import("AppKit"); const p=$.NSEvent.mouseLocation; JSON.stringify({x:p.x,y:p.y})'])});
writeFileSync(DOC,'MAWS computer-use probe document.\n');
execFileSync('open',['-g','-a','TextEdit',DOC]);
await new Promise(r=>setTimeout(r,2500));
const meta={'x-codex-turn-metadata':{session_id:'maws-probe-s1',thread_id:'maws-probe-s1',turn_id:'maws-probe-t1',model:'probe'},callId:'call-probe',threadId:'maws-probe-s1',sessionId:'maws-probe-s1'};
await run('w2-textedit-actions',async p=>{
 let asks=0;p.on('elicitation/create',params=>{const m=params._meta||{};const ok=m.tool_params?.app==='com.apple.TextEdit';asks++;
  p.note({event:'elicitation_decision',accept:ok,message:params.message,meta:m});return ok?{action:'accept',content:{},_meta:{persist:'session'}}:{action:'decline'};});
 await p.init();await p.request('tools/list',{});
 const js=async(title,code)=>{const before=observe();const a0=asks;const r=await p.callTool('js',{title,code,timeout_ms:60000},{meta});const after=observe();
  p.note({event:'observe',title,before,after,elicitations:asks-a0});const texts=r.content.filter(c=>c.type==='text').map(c=>c.text);
  console.log('##',title,'| isError',!!r.isError,'| elicitations',asks-a0,'| front',before.frontmost,'→',after.frontmost,'| mouse',before.mouse,'→',after.mouse,'\n'+texts.join('\n').slice(-900));return r;};
 await js('bind','globalThis.app = await cua.getApp("TextEdit"); globalThis.idx = Number((await app.getAXState({disableDiffing:true, emit:false})).match(/^\\s*(\\d+)\\s[^\\n]*ID: First Text View/m)[1]); nodeRepl.write("text view index=" + idx);');
 await js('click index, end of doc, type','await app.click(idx); await app.pressKey("super+Down"); await app.typeText(" Typed by computer use."); await app.getAXState();');
 await js('coordinate click at screenshot pixel (20,76) then type','await app.click([20, 76]); await app.typeText("[px20,76]"); await app.getAXState();');
 await js('setValue via AX','await app.setValue(idx, "Replaced by setValue."); const s = await app.getAXStateAndScreenshot({disableDiffing:true});');
 const ended=await p.callTool('turn_ended',{hook_event_name:'Stop',session_id:'maws-probe-s1',turn_id:'maws-probe-t1'});p.note({event:'turn_ended_result',ended});
 await js('save and quit','await app.pressKey("super+s"); await app.pressKey("super+q");');
},{...cuaRepl(),capabilities:{elicitation:{form:{}}}});
console.log('doc on disk:',JSON.stringify(readFileSync(DOC,'utf8')));
const st=SCRATCH+'/codex-home/computer-use';console.log('scratch computer-use state:',existsSync(st)?JSON.stringify(readdirSync(st,{recursive:true})):'none');
console.log('TextEdit still running:',sh('osascript',['-e','tell application "System Events" to (name of processes whose name is "TextEdit")'])||'no');
