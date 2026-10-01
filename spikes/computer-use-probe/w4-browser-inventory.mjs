// W4-0: the shim with the browser surface on, read-only. Lists browsers and apps through cua.getState(); opens no tab
// and approves nothing. Shows which browser backends a non-Codex host can see, and why the in-app browser is missing.
import {run,root} from './mcp-client.mjs';
const sid=process.argv[2]??'w4-browser-inventory';
await run('w4-browser-inventory',async p=>{
 p.on('elicitation/create',params=>{p.note({event:'elicitation',message:params.message});console.log('elicitation (declined):',params.message);return {action:'decline'};});
 await p.init();
 const tools=await p.request('tools/list',{});
 const jsDesc=tools.tools.find(t=>t.name==='js')?.description??'';
 console.log('js description mentions browser:',/createBrowserTab|getBrowser/.test(jsDesc),'| disabled note:',/Browser APIs are disabled/.test(jsDesc));
 const show=r=>console.log('isError',!!r.isError,'\n'+r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n').slice(0,6000));
 show(await p.callTool('js',{title:'inventory',code:'await cua.getState();',timeout_ms:60000}));
 show(await p.callTool('js',{title:'browsers',code:'const s = await cua.getState({emit:false}); nodeRepl.write(JSON.stringify({browsers:s.browsers,errors:s.errors},null,1));',timeout_ms:60000}));
},{command:process.execPath,args:[root+'../../plugins/cua/cua-shim.mjs'],env:{CUA_SHIM_CODEX_HOME:'/tmp/maws-cu-probe/w4-home',CUA_SHIM_SURFACES:'browser,computer',CUA_SHIM_SESSION_ID:sid,CUA_SHIM_LOG:root+'fixtures/w4-browser-inventory.shim.jsonl'},capabilities:{elicitation:{}}});
