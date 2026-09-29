// Debt wave 3 (docs/tech-debt-tracker.md, the C3 row "C3's normaliser always sends supersedes: null and aborted:
// false"; C3 execution document docs/doperpowers/plans/2026-09-28-c3-engine-host.md): an interrupt while a text block
// is streaming. The engine's stream loop flushes the open text block as a partial assistant message marked
// `isAbortedMidStream` when the query source is `sdk` (SPEC 07's stream-end table; the wire converter writes it as
// `aborted: true`, SPEC 45); the notes record whether print mode sends that frame.
import {scratch} from '../../harness.mjs';
import {launch,scratchConfigHome,initPayload,success,check,endAsStop,RELAY_ENV} from './c10-common.mjs';
import {realpathSync} from 'node:fs';

const PROVENANCE={child:'C3',document:'docs/doperpowers/plans/2026-09-28-c3-engine-host.md',milestone:'debt wave 3',row:'supersedes and aborted on assistant.block.complete'};
const TEXT_DELTAS=8;

export default async()=>{
 const repo=realpathSync(scratch('/tmp/maws-probe3-interrupt-'));
 const configHome=scratchConfigHome();
 const {p}=await launch('interrupt-text',{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','0.10'],provenance:PROVENANCE},async p=>{
  success(await p.init(initPayload()),'initialize');
  const after=p.seq;
  p.user('Without using any tools, write a 500-word essay on the history of tea, as plain prose paragraphs.');
  let deltas=0;
  await p.wait(f=>f.type==='stream_event'&&f.event?.type==='content_block_delta'&&f.event.delta?.type==='text_delta'&&++deltas>=TEXT_DELTAS,{after});
  const interrupted=await p.request('interrupt',{});
  const result=await p.wait(f=>f.type==='result',{after});
  const assistants=p.frames.filter(r=>r.seq>after&&r.frame.type==='assistant').map(r=>({seq:r.seq,uuid:r.frame.uuid,aborted:r.frame.aborted??null,blocks:r.frame.message.content.map(b=>b.type),textChars:r.frame.message.content.filter(b=>b.type==='text').reduce((n,b)=>n+b.text.length,0)}));
  p.note({event:'interrupt_text',textDeltasBeforeInterrupt:deltas,interrupt:interrupted.subtype,assistants,result:{subtype:result.subtype,terminal_reason:result.terminal_reason??null}});
  check(p,'the turn was interrupted while streaming',result.terminal_reason==='aborted_streaming',result.terminal_reason);
  // a completed turn last, so the process exits 0 (first run: exit 1 after the interrupted turn was the last)
  await p.turn('Reply with exactly OK');
  await endAsStop(p);
 });
 console.log('interrupt-text recorded',p.file);
};
