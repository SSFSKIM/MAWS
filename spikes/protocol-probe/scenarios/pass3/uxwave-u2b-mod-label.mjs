// UX wave U2b, check 1, the resumed part (no model call): §I item 13 (`labelOf`'s clause 4) and its follow-up on the
// branch (a fold read from the run inside its stretch is asked again when its stretch's end moves), as MAWS's surface
// meets them (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, §M "Which run a line reads").
//
// The seeded session, resumed at 9 with "after", with a folds file of the contract's shape written beside it as the
// tracker would have written it: the first stretch's run bounded by its first call and its unmarked text (the tracker
// follows no thinking, so the run begins after the thought that heads the stretch), the second's by the mixed text and
// the task notice. First the thought is asked alone (its stretch's end is itself: clause 4 finds no run inside), then
// the group (which moves the stretch's end past the run's first row): the pushes between are noted, and the thought is
// asked again; then every row. Fixture u2b-mod-label.jsonl.
import {scratch,seed,mawsLaunch,askAll,render,pushesSince,ROWS,ASK,ID,SID,removeRun,foldsFileOf,delay} from './uxwave-u2b-mod-common.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export default async()=>{
 const run=scratch('label','after');seed(run);
 const folds={shape:2,runs:[[ID.t1,ID.a5,'Listed the three notes and sorted the first one'],[ID.a7,ID.u3,'Checked the archive and heard back from the helper']]};
 const file=foldsFileOf(run,SID);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(folds)+'\n');
 try{
  await mawsLaunch('u2b-mod-label',run,{advert:'9',resume:SID,offline:true,provenance:{part:'resumed',questions:['§I item 13 (clause 4)','the branch\'s re-ask when a stretch\'s end moves'],foldsFile:folds}},async p=>{
   await render(p,ASK.thought(),'the thought alone');await delay(4000);
   await render(p,ASK.thought(),'the thought alone, after the start-up read');
   const at=p.seq;
   await render(p,ASK.group(),'the group (the stretch\'s end moves past the run\'s first row)');
   await delay(1500);
   p.note({event:'u2b_pushes',after:'the group drew',pushes:pushesSince(p,at)});
   await render(p,ASK.thought(),'the thought again');
   await askAll(p,ROWS,'every row');
  });
 }finally{removeRun(run);}
};
