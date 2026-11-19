// UX wave U2b, check 1, the resumed part (no model call): questions C1 to C5
// (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, check 1; §E, §I items 4 to 6).
//
// Main case (fixture u2b-mod-rows.jsonl): the seeded session resumed at 9 with "after". A probe plugin of a few lines,
// outermost (first in prependPlugins), logs every `ui.render` event of the sites asked here as it reaches the hooks
// (the component, `e.requestId`, the props' keys) and what `next(e)` handed back beneath it, then returns that
// unchanged: it shows whether the engine runs a surface's ask through the hooks and with which id (C1, C3). The rows of
// the seed are asked once to warm the view, then the asks of C1 to C3 and C5 in three states: folded, the first run
// open, the full transcript.
//
// C2 before (fixture u2b-mod-rows-none-before.jsonl): the same with "before" and no advertisement (0.8.2 steps aside
// at any advertisement, so only there can it be seen to fold a thought).
//
// C4 (fixtures u2b-mod-lone-<thought|listing|notice|turn>.jsonl): one launch per row, at 9 with "after", that asks
// that row alone and no other row of the transcript: folded, after each press of the view's switch (the band is asked
// for its switch; it is no row), and after reload_plugins.
//
// U2B_ROWS picks parts (comma-separated): main, before, lone (default all).
import {scratch,seed,mawsLaunch,askAll,render,press,pushesSince,ROWS,ASK,ID,TEXT,SID,removeRun,delay} from './uxwave-u2b-mod-common.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

const PARTS=(process.env.U2B_ROWS||'main,before,lone').split(',');
const SITES=['TurnDuration','UserMessage','AssistantMessage','ToolUse','ToolGroup'];
const PROBE=`export const register = on => {
  for (const component of ${JSON.stringify(SITES)}) on('ui.render', { component }, async ($, e, next) => {
    const drawn = await next(e)
    $.ui.log('U2B_PROBE ' + JSON.stringify({ component, requestId: e.requestId, surface: e.surface, props: Object.keys(e.props ?? {}).sort(), next: drawn && typeof drawn === 'object' ? (drawn.type ?? 'element') : String(drawn) }))
    return drawn
  })
}
`;
function addProbe(run){
 const dir=join(run.plugins,'probe');mkdirSync(join(dir,'.claude-plugin'),{recursive:true});mkdirSync(join(dir,'hooks'));
 writeFileSync(join(dir,'.claude-plugin/plugin.json'),JSON.stringify({name:'u2b-probe',version:'0.0.1',description:'logs the ui.render events it sees and passes them through'}));
 writeFileSync(join(dir,'hooks/hooks.json'),JSON.stringify({modules:['./probe.tsx']}));
 writeFileSync(join(dir,'hooks/probe.tsx'),PROBE);
 run.dirs.unshift(dir);
 const s=JSON.parse(readFileSync(join(run.cfg,'settings.json'),'utf8'));s.prependPlugins=['u2b-probe@inline',...s.prependPlugins];writeFileSync(join(run.cfg,'settings.json'),JSON.stringify(s)+'\n');
}
const logs=(p,at)=>p.frames.filter(r=>r.seq>at&&r.frame.type==='system'&&r.frame.subtype==='ui_log'&&String(r.frame.text).startsWith('U2B_PROBE')).map(r=>({seq:r.seq,...JSON.parse(r.frame.text.slice(10))}));

// The asks of C1 to C3 and C5 beyond the seed's rows.
const NOTICE_LINE='Answered “Which archive should the notes go to?”: Old';
const EXTRA=[
 ['C1 turn 1 line (after the prompt)',ASK.turn(ID.u1)],
 ['C1 turn 2 line (after the delivery)',ASK.turn(ID.u4,3000)],
 ['C1 turn line, a plain id',{component:'TurnDuration',instance_id:'turn-line-plain',props:{word:'Worked',durationMs:42000,isExpanded:true}}],
 ['C2 thought, bare uuid',ASK.thought()],
 ['C2 thought, uuid:thinking:0',ASK.thought(ID.a1+':thinking:0')],
 ['C2 thought, uuid:text:0',ASK.thought(ID.a1+':text:0')],
 ['C3 scheduled trigger after the unmarked text',ASK.notice(ID.a5,'sched-1','scheduled-trigger','Scheduled task "tidy" fired')],
 ['C3 wake (plugin) after the unmarked text',ASK.notice(ID.a5,'wake-1','plugin','sminos woke the session')],
 ['C3 task end after the listing',ASK.notice(ID.t6,'task-1','task-notification','Background command "sleep 2" completed',{task:{id:'bhost0001',status:'completed',toolUseId:'toolu_01SeedBackground00008'}})],
 ['C3 peer after the listing',ASK.notice(ID.t6,'peer-1','peer','A note from another session',{from:{name:'session:0a1b2c3d'}})],
 ['C3 scheduled trigger after the final text',ASK.notice(ID.a9,'sched-2','scheduled-trigger','Scheduled task "tidy" fired again')],
 ['C5 answer notice, origin plugin, after the question',ASK.notice(ID.t5,'answered-1','plugin',NOTICE_LINE)],
 ['C5 delivery text, origin sdk',ASK.answer()],
 ['C5 delivery text, origin plugin',{component:'UserMessage',instance_id:ID.u4,props:{text:TEXT.answerDelivery,origin:{kind:'plugin'},isExpanded:true}}],
 ['C5 delivery text, origin unclassified',{component:'UserMessage',instance_id:ID.u4,props:{text:TEXT.answerDelivery,origin:{kind:'unclassified'},isExpanded:true}}],
];

async function main(which,advert,name){
 const run=scratch(name.replace('u2b-mod-',''),which);seed(run);addProbe(run);
 try{
  await mawsLaunch(name,run,{advert,resume:SID,offline:true,provenance:{part:'resumed',questions:['C1','C2','C3','C5'],probePlugin:'outermost; logs ui.render events (component, requestId, prop keys, what next(e) returned) and passes them through',probeSource:PROBE}},async p=>{
   await askAll(p,ROWS,'warm');await delay(4000);
   const warm=await askAll(p,ROWS,'seed rows');
   let at=p.seq;
   await askAll(p,EXTRA,'folded');
   p.note({event:'u2b_probe_log',state:'folded',lines:logs(p,at)});
   const head=warm.find(r=>r.buttons.length&&r.kind!=='engine');
   if(head){
    await press(p,head.tree,'to-human-toggle','open the first run');
    at=p.seq;await askAll(p,[...ROWS,...EXTRA],'first run open');p.note({event:'u2b_probe_log',state:'first run open',lines:logs(p,at)});
    const again=await render(p,ASK.thought(),'thought, to fold the run back');
    await press(p,again.tree,'to-human-toggle','fold the first run');
   }
   const mixed=await render(p,ASK.mixed(),'mixed, to open the second run');
   if(mixed.brief.buttons.length){
    await press(p,mixed.tree,'to-human-toggle','open the second run');
    at=p.seq;await askAll(p,[...ROWS,...EXTRA],'second run open');p.note({event:'u2b_probe_log',state:'second run open',lines:logs(p,at)});
    const m2=await render(p,ASK.mixed(),'mixed, to fold the second run');
    const end=(await askAll(p,ROWS,'second run open, its end')).find(r=>r.buttons.some(b=>/fold to report/.test(b)));
    if(end)await press(p,end.tree,'to-human-toggle','fold the second run');
    void m2;
   }
   const band=await render(p,ASK.band(),'band');
   if(band.brief.buttons.some(b=>b.key==='to-human-mode')){
    await press(p,band.tree,'to-human-mode','full transcript');
    at=p.seq;await askAll(p,[...ROWS,...EXTRA],'full transcript');p.note({event:'u2b_probe_log',state:'full transcript',lines:logs(p,at)});
   }
  });
 }finally{removeRun(run);}
}

// C4: one row asked alone.
const LONE={
 thought:ASK.thought(),
 listing:ASK.call('t6'),
 notice:ASK.notice(ID.a5,'sched-1','scheduled-trigger','Scheduled task "tidy" fired'),
 turn:ASK.turn(ID.u1),
};
async function lone(kind){
 const name='u2b-mod-lone-'+kind;const ask=LONE[kind];
 const run=scratch('lone-'+kind,'after');seed(run);
 try{
  await mawsLaunch(name,run,{advert:'9',resume:SID,offline:true,provenance:{part:'resumed',questions:['C4'],lone:kind,ask}},async p=>{
   await render(p,ask,'alone, first ask');await delay(4000);
   await render(p,ask,'alone, after the start-up read');
   let band=await render(p,ASK.band(),'band (for its switch)');
   let at=p.seq;let pr=await press(p,band.tree,'to-human-mode','full transcript');
   p.note({event:'u2b_pushes',after:'full transcript',pushes:pushesSince(p,at)});
   await render(p,ask,'alone, in the full transcript');
   band=await render(p,ASK.band(),'band in the full transcript');
   at=p.seq;pr=await press(p,band.tree,'to-human-mode','report only');
   p.note({event:'u2b_pushes',after:'report only',pushes:pushesSince(p,at)});
   await render(p,ask,'alone, back in the report');
   at=p.seq;const reload=await p.request('reload_plugins',{},60000);
   p.note({event:'u2b_reload',subtype:reload.subtype,pushes:pushesSince(p,at)});
   await render(p,ask,'alone, just after reload_plugins');await delay(4000);
   await render(p,ask,'alone, after reload_plugins and its start-up read');
   void pr;
  });
 }finally{removeRun(run);}
}

export default async()=>{
 if(PARTS.includes('main'))await main('after','9','u2b-mod-rows');
 if(PARTS.includes('before'))await main('before',null,'u2b-mod-rows-none-before');
 if(PARTS.includes('lone'))for(const k of Object.keys(LONE))await lone(k);
};
