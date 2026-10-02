// R0 question 3 (mods-common.mjs): the launch of mods-pushes, then MAWS attaching as a remote "desktop" surface right
// after initialize, as Claude Desktop 2.16120.0 does (its client of the engine's remote-surface protocol: ui_attach with
// the four answers it names, then ui_render per site; the band's props are Desktop's, c95e4d2cf-BLkI1oZK.js:9933-9941).
// Asks the AbovePrompt band before and after one no-tools turn, the pane roster, and one site no plugin hooks
// (SessionMode), then detaches; presses nothing. Records the element trees and any ui_invalidate or ui_panes push.
import {scratchRun,removeRun,launch,initPayload,success,check,endAsStop,summarize,promptTurn,uiPushes,GATE} from './mods-common.mjs';

const CLIENT='maws-probe';
const VIEWPORT={columns:100,rows:30};
const band=isWorking=>({surface:'desktop',client_id:CLIENT,component:'AbovePrompt',instance_id:'above-prompt',props:{hasSurvey:false,isWorking,maxRows:12,bodyColumns:VIEWPORT.columns,scroll:{offset:0,bodyRows:12},view:{}},viewport:VIEWPORT});

export default async()=>{
 const run=scratchRun('attach',{settings:{env:{[GATE]:'1'}}});
 try{
  await launch('mods-attach',run,{provenance:{question:'R0 Q3 ui_attach and ui_render of the AbovePrompt band'}},async p=>{
   const init=success(await p.init(initPayload(run.cwd)),'initialize');
   p.note({event:'initialize_capabilities',capabilities:init.capabilities??null});
   const attach=await p.request('ui_attach',{surface:'desktop',client_id:CLIENT,viewport:VIEWPORT,answers:['ui_copy','ui_prompt_read','ui_prompt_fill','ui_prompt_suggest']});
   p.note({event:'ui_attach_answer',response:attach});
   const before=await p.request('ui_render',band(false));
   p.note({event:'ui_render_band_before_turn',response:before});
   const panes=await p.request('ui_panes',{client_id:CLIENT});
   p.note({event:'ui_panes_answer',response:panes});
   const unhooked=await p.request('ui_render',{surface:'desktop',client_id:CLIENT,component:'SessionMode',instance_id:'session-mode',props:{},viewport:VIEWPORT});
   p.note({event:'ui_render_unhooked_site',response:unhooked});
   await promptTurn(p);
   const after=await p.request('ui_render',band(false));
   p.note({event:'ui_render_band_after_turn',response:after});
   const detach=await p.request('ui_detach',{client_id:CLIENT});
   p.note({event:'ui_detach_answer',response:detach});
   const s=summarize(p,'mods-attach');
   p.note({event:'pushes_after_attach',subtypes:uiPushes(p).filter(f=>f.seq>p.frames.find(r=>r.frame.type==='control_response'&&r.frame.response?.request_id&&r.frame.response.response?.surfaces)?.seq).map(f=>f.subtype)});
   check(p,'ui_attach succeeded',attach.subtype==='success');
   check(p,'ui_render answered the band',before.subtype==='success'&&!!before.response?.tree);
   check(p,'one turn answered',s.answer!==null);
   await endAsStop(p);
  });
 }finally{removeRun(run);}
};
