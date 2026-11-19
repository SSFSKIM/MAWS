// UX wave U2b, check 1, the resumed part (no model call): question A3, and question B on each reload
// (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, check 1; §G's reload rows).
//
// One launch at 9 with "after" installed, the seeded session resumed. Every row and the band are asked; then the
// installation in the scratch plugin folder is swapped for "before" (the same path the launch's --plugin-dir names) and
// reload_plugins sent; every row and the band asked again; then swapped back to "after", reloaded, asked again. Each
// reload's answer is read for the mod's entry (name, path, version) and what that path holds at its root, the
// declaration among it, so each step can be read as §A's `drawnBy` would read it. Fixture u2b-mod-reload.jsonl.
import {scratch,seed,install,mawsLaunch,askAll,render,pushesSince,ROWS,ASK,SID,removeRun,pluginsOf,rootOf,delay} from './uxwave-u2b-mod-common.mjs';

export default async()=>{
 const run=scratch('reload','after');seed(run);
 try{
  await mawsLaunch('u2b-mod-reload',run,{advert:'9',resume:SID,offline:true,provenance:{part:'resumed',questions:['A3','B']}},async p=>{
   const step=async(label)=>{await askAll(p,ROWS,label);await render(p,ASK.band(),label+': band');};
   await askAll(p,ROWS,'warm');await delay(4000);
   await step('step 1, after as launched');
   for(const which of ['before','after']){
    const i=install(run,which);
    p.note({event:'u2b_swap',to:which,commit:i.commit,version:i.version,declaration:i.declaration});
    const at=p.seq;
    const reload=await p.request('reload_plugins',{},60000);
    const plugins=pluginsOf(reload.response?.plugins);
    p.note({event:'u2b_reload',to:which,subtype:reload.subtype,plugins,toHumanRoot:plugins.filter(x=>x.name==='to-human').map(x=>({path:x.path,...rootOf(x.path)})),pushes:pushesSince(p,at)});
    await delay(1500);
    await askAll(p,ROWS,`swapped to ${which}, just after reload_plugins`);
    await delay(4000);
    await step(`step ${which==='before'?2:3}, ${which} after reload_plugins`);
   }
  });
 }finally{removeRun(run);}
};
