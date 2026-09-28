// W2-2: full perception and action loop from a neutral (non-Codex) MCP client, confined to a throwaway TextEdit
// document this script creates in /tmp. Only TextEdit approvals are accepted; every other elicitation is declined.
import {run} from './mcp-client.mjs';
import {cuaRepl,SCRATCH} from './cua-env.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
const DOC=SCRATCH+'/textedit-probe.txt';
const sh=(cmd,args)=>{try{return execFileSync(cmd,args,{encoding:'utf8'}).trim();}catch(e){return 'ERR '+e.message.split('\n')[0];}};
const observe=()=>({frontmost:sh('osascript',['-e','tell application "System Events" to name of first application process whose frontmost is true']),
 mouse:sh('osascript',['-l','JavaScript','-e','ObjC.import("AppKit"); const p=$.NSEvent.mouseLocation; JSON.stringify({x:p.x,y:p.y})']),
 window:sh('osascript',['-e','tell application "System Events" to tell process "TextEdit" to get {position, size} of window 1']),
 screen:sh('osascript',['-l','JavaScript','-e','ObjC.import("AppKit"); const s=$.NSScreen.mainScreen; JSON.stringify({w:s.frame.size.width,h:s.frame.size.height,scale:s.backingScaleFactor})'])});
writeFileSync(DOC,'MAWS computer-use probe document.\n');
execFileSync('open',['-g','-a','TextEdit',DOC]);
await new Promise(r=>setTimeout(r,2500));
await run('w2-textedit',async p=>{
 p.on('elicitation/create',params=>{const meta=params._meta||{};const ok=meta.tool_params?.app==='com.apple.TextEdit';
  p.note({event:'elicitation_decision',accept:ok,message:params.message});return ok?{action:'accept',content:{},_meta:{persist:'session'}}:{action:'decline'};});
 await p.init();const tools=await p.request('tools/list',{});p.note({event:'tools',tools:tools.tools});
 const js=async(title,code)=>{p.note({event:'observe_before',title,...observe()});const r=await p.callTool('js',{title,code,timeout_ms:60000});
  p.note({event:'observe_after',title,...observe()});const texts=r.content.filter(c=>c.type==='text').map(c=>c.text);
  console.log('##',title,'isError',!!r.isError,'items',r.content.map(c=>c.type).join(','),'\n',texts.join('\n').slice(-1500));return r;};
 await js('bind TextEdit','globalThis.app = await cua.getApp("TextEdit");');
 await js('full tree + screenshot','globalThis.s1 = await app.getAXStateAndScreenshot({disableDiffing:true}); nodeRepl.write(`screenshot bytes=${s1.screenshot?.length} magic=${Buffer.from(s1.screenshot.slice(0,8)).toString("hex")}`);');
 await js('click text area and type',`const m = s1.state.match(/^\\s*(\\d+)\\s+text (?:area|entry area)/im) || s1.state.match(/(\\d+)[^\\n]*text area/i); nodeRepl.write("text area index=" + (m && m[1]));
  await app.click(Number(m[1])); await app.pressKey("super+Down"); await app.typeText(" Typed by computer use."); globalThis.s2 = await app.getAXStateAndScreenshot();`);
 await js('setValue via AX',`const m = s1.state.match(/^\\s*(\\d+)\\s+text (?:area|entry area)/im) || s1.state.match(/(\\d+)[^\\n]*text area/i); await app.setValue(Number(m[1]), "MAWS computer-use probe document. Replaced by setValue."); nodeRepl.write(await app.getAXState());`);
 await js('coordinate click at window center','const img = s1.screenshot; nodeRepl.write("no-op coordinate probe skipped");');
 const ended=await p.callTool('turn_ended',{hook_event_name:'Stop',session_id:'maws-probe-session',turn_id:'maws-probe-turn-1'});p.note({event:'turn_ended_result',ended});
 await js('quit TextEdit','await app.pressKey("super+s"); await app.pressKey("super+q");');
 p.tree('end');
},{...cuaRepl(),capabilities:{elicitation:{form:{}}}});
console.log('doc on disk:',JSON.stringify(readFileSync(DOC,'utf8')));
const sess=SCRATCH+'/codex-home/computer-use';console.log('scratch computer-use state:',existsSync(sess)?readdirSync(sess,{recursive:true}):'none');
console.log('TextEdit still running:',sh('osascript',['-e','tell application "System Events" to (name of processes whose name is "TextEdit")']));
