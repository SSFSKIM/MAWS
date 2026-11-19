// UX wave U2b, check 1, the resumed part (no model call; an unreachable API endpoint): questions A1, A2, B and D
// (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, check 1). See uxwave-u2b-mod-common.mjs for the
// launch and the installations.
//
// For each advertisement (none, 8, 9) and installation (before, after): the seeded session is resumed as MAWS resumes
// one, the surface attached, and every row of the seed asked in order with MAWS's props, twice (the second after the
// mod's start-up read has surely landed), then the band; where the band carries the view's switch, the first run's
// button is pressed (open), every row asked again, the button pressed again (folded), the switch pressed (the full
// transcript), every row asked again, and the switch pressed back. Last, reload_plugins: the mod's entry by name and
// path (question B). Fixture u2b-mod-<none|8|9>-<before|after>.jsonl.
//
// U2B_CASES (comma-separated, default all six) picks cases, e.g. `9-after,none-after`. `nohooks` is question D's last
// clause: none-after with disableAllHooks (fixture u2b-mod-none-after-nohooks.jsonl).
import {scratch,seed,mawsLaunch,askAll,render,press,pushesSince,ROWS,ASK,SID,removeRun,pluginsOf,rootOf,delay} from './uxwave-u2b-mod-common.mjs';

const ALL=['none-before','none-after','8-before','8-after','9-before','9-after'];
const CASES=(process.env.U2B_CASES||ALL.join(',')).split(',').filter(Boolean);

async function resumed(tag){
 const nohooks=tag==='nohooks';
 const [adv,which]=nohooks?['none','after']:tag.split('-');
 const advert=adv==='none'?null:adv;
 const name=nohooks?'u2b-mod-none-after-nohooks':`u2b-mod-${adv}-${which}`;
 const run=scratch(name.replace('u2b-mod-',''),which);
 seed(run);
 try{
  await mawsLaunch(name,run,{advert,resume:SID,offline:true,hooksOff:nohooks,provenance:{part:'resumed',questions:nohooks?['D']:['A1','A2','B','D'],seed:'uxwave-u2b-mod-common.mjs seedRows (invented text)'}},async p=>{
   await askAll(p,ROWS,'pass 1');
   await delay(4000);
   const second=await askAll(p,ROWS,'pass 2');
   let band=await render(p,ASK.band(),'band');
   if(band.brief.buttons.some(b=>b.key==='to-human-mode')){
    const head=second.find(r=>r.buttons.length&&r.kind!=='engine');
    if(head){
     const opened=await press(p,head.tree,'to-human-toggle',`open the run that ${head.name} heads`);
     p.note({event:'u2b_pushes',after:'open',pushes:opened?.pushes});
     const open=await askAll(p,ROWS,'run open');
     const closer=open.find(r=>r.buttons.some(b=>/fold to report/.test(b)));
     if(closer){const folded=await press(p,closer.tree,'to-human-toggle','fold it back');p.note({event:'u2b_pushes',after:'fold',pushes:folded?.pushes});}
     await askAll(p,ROWS,'run folded again');
    }
    const full=await press(p,band.tree,'to-human-mode','full transcript');
    p.note({event:'u2b_pushes',after:'full transcript',pushes:full?.pushes});
    band=await render(p,ASK.band(),'band in the full transcript');
    await askAll(p,ROWS,'full transcript');
    const back=await press(p,band.tree,'to-human-mode','report only');
    p.note({event:'u2b_pushes',after:'report only',pushes:back?.pushes});
    await render(p,ASK.band(),'band back in the report');
    await askAll(p,ROWS,'report again');
   }
   const at=p.seq;
   const reload=await p.request('reload_plugins',{},60000);
   const plugins=pluginsOf(reload.response?.plugins);
   p.note({event:'u2b_reload',plugins,toHumanRoot:plugins.filter(x=>x.name==='to-human').map(x=>({path:x.path,...rootOf(x.path)})),pushes:pushesSince(p,at)});
   await delay(1500);
   await askAll(p,ROWS,'after reload_plugins');
   await render(p,ASK.band(),'band after reload_plugins');
  });
 }finally{removeRun(run);}
}

export default async()=>{for(const tag of CASES)await resumed(tag);};
