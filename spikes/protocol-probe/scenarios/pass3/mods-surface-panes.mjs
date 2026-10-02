// R2 (mods-surface-common.mjs): a pane's life on a desktop surface. Opened by a press (`$.ui.open`): the ui_panes push,
// the roster read, the Pane site; the person shows it, gives it the keyboard and reports the hold (ui_pane_show,
// ui_pane_focus, ui_focus); the mod moves the ring (`$.ui.focus`, the ui_focus push) and, after the surface reported the
// layout (ui_scroll), the window (`$.ui.scroll`, the ui_scroll push); the person wheels; the keyboard goes back; the
// person closes it (ui_close and the push that drops it).
import {surfaceRun,render,SITES,ask,element,push,turn,check,CLIENT,PANE} from './mods-surface-common.mjs';

const pressOf=(tree,key)=>{const el=element(tree,key);if(!el)throw new Error('no element '+key);return {plugin:el.press.plugin,handle:el.press.handle,key};};

export default ()=>surfaceRun('mods-surface-panes','R2: ui_panes pushes and reads, ui_pane_show, ui_pane_focus, ui_focus and ui_scroll both ways, ui_close',{},async p=>{
 const band=await render(p,SITES.band(false),'band at rest');
 let at=p.seq;
 await ask(p,'ui_press',{...pressOf(band.response.tree,'open-pane'),surface:'desktop',client_id:CLIENT},'press open pane');
 const opened=await push(p,'ui_panes',at);
 check(p,'the push lists the pane',(opened.panes??[]).some(x=>x.id===PANE),opened);
 await ask(p,'ui_panes',{client_id:CLIENT},'roster after the open');
 let pane=await render(p,SITES.pane(false),'pane opened');
 await ask(p,'ui_pane_show',{id:PANE,surface:'desktop',client_id:CLIENT},'show');
 await ask(p,'ui_pane_focus',{id:PANE,surface:'desktop',client_id:CLIENT},'pane takes the keyboard');
 await ask(p,'ui_focus',{component:'Pane',instance_id:PANE,is_held:true,element:null,by:'person',surface:'desktop',client_id:CLIENT},'focus held on the container');
 pane=await render(p,SITES.pane(true),'pane focused');
 at=p.seq;
 await ask(p,'ui_press',{...pressOf(pane.response.tree,'focus'),surface:'desktop',client_id:CLIENT},'press focus pick');
 const focused=await push(p,'ui_focus',at,8000).catch(e=>({error:e.message}));
 p.note({event:'focus_push',frame:focused});
 await ask(p,'ui_scroll',{component:'Pane',instance_id:PANE,offset:0,by:0,body_rows:4,content_rows:20,surface:'desktop',client_id:CLIENT},'layout report');
 at=p.seq;
 await ask(p,'ui_press',{...pressOf(pane.response.tree,'scroll'),surface:'desktop',client_id:CLIENT},'press scroll to end');
 const scrolled=await push(p,'ui_scroll',at,8000).catch(e=>({error:e.message}));
 p.note({event:'scroll_push',frame:scrolled});
 await ask(p,'ui_scroll',{component:'Pane',instance_id:PANE,offset:16,by:-3,body_rows:4,content_rows:20,surface:'desktop',client_id:CLIENT},'person wheels up');
 await ask(p,'ui_pane_focus',{id:null,surface:'desktop',client_id:CLIENT},'keyboard back to the composer');
 at=p.seq;
 const closed=await ask(p,'ui_close',{id:PANE,surface:'desktop',client_id:CLIENT},'person closes the pane');
 check(p,'the pane closed',closed.response?.closed===true,closed);
 const after=await push(p,'ui_panes',at);
 check(p,'the push drops it',!(after.panes??[]).some(x=>x.id===PANE),after);
 await turn(p);
});
