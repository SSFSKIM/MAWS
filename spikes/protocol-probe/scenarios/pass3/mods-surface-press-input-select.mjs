// R2 (mods-surface-common.mjs): a press, an input's changes and Enter, and a pick, each naming the element by the
// `press.plugin` and `press.handle` the latest drawing carried, with the engine's answers and the invalidate pushes the
// mod's handlers cause, each followed by the re-ask the app makes; and a pick on a handle no element holds.
import {surfaceRun,render,SITES,ask,element,push,turn,check,CLIENT,PANE} from './mods-surface-common.mjs';

const pressOf=(tree,key)=>{const el=element(tree,key);if(!el)throw new Error('no element '+key);return {plugin:el.press.plugin,handle:el.press.handle,key};};

export default ()=>surfaceRun('mods-surface-press-input-select','R2: ui_press, ui_input (change and submit) and ui_select round trips',{},async p=>{
 let band=await render(p,SITES.band(false),'band at rest');
 let at=p.seq;
 const press=await ask(p,'ui_press',{...pressOf(band.response.tree,'press'),surface:'desktop',client_id:CLIENT},'press');
 check(p,'the press reached its handler',press.response?.handled===true,press);
 await push(p,'ui_invalidate',at);
 band=await render(p,SITES.band(false),'band after the press');
 const reply=pressOf(band.response.tree,'reply');
 const field={plugin:reply.plugin,handle:reply.handle,key:'reply',component:'AbovePrompt',instance_id:'above-prompt',surface:'desktop',client_id:CLIENT};
 await ask(p,'ui_input',{...field,kind:'change',value:'hel'},'input change 1');
 await ask(p,'ui_input',{...field,kind:'change',value:'hello'},'input change 2');
 at=p.seq;
 const submit=await ask(p,'ui_input',{...field,kind:'submit',value:'hello'},'input submit');
 check(p,'the submit reached its handler',submit.response?.handled===true,submit);
 await push(p,'ui_invalidate',at);
 band=await render(p,SITES.band(false),'band after the submit');
 at=p.seq;
 await ask(p,'ui_press',{...pressOf(band.response.tree,'open-pane'),surface:'desktop',client_id:CLIENT},'press open pane');
 await push(p,'ui_panes',at);
 let pane=await render(p,SITES.pane(false),'pane opened');
 const pick=pressOf(pane.response.tree,'pick');
 at=p.seq;
 const select=await ask(p,'ui_select',{plugin:pick.plugin,handle:pick.handle,key:'pick',value:'two',component:'Pane',instance_id:PANE,surface:'desktop',client_id:CLIENT},'select two');
 check(p,'the pick reached its handler',select.response?.handled===true,select);
 await push(p,'ui_invalidate',at);
 pane=await render(p,SITES.pane(false),'pane after the pick');
 const stale=await ask(p,'ui_select',{plugin:pick.plugin,handle:999999,value:'one',surface:'desktop',client_id:CLIENT},'select on a handle no element holds');
 check(p,'a stale handle is not handled',stale.response?.handled===false,stale);
 await turn(p);
});
