// R2, the mods surface probe (docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md §2 K and §6, the architect's
// R2 rulings; study docs/doperpowers/evidence/ux-2026-10-01/r6-claude-mods.txt §3.7; child C2 of docs/charter.md). The
// helpers the mods-surface-* scenarios share, over R0's (mods-common.mjs: the installed 2.1.287 by absolute path with
// MAWS's launch line and initialize payload, a scratch CLAUDE_CONFIG_DIR under /tmp created and deleted per run,
// DISABLE_AUTOUPDATER=1, the relay's marker token, no turn but a no-tools one).
//
// A fresh config home has the rollout cache cold, so the function-hooks switch is on (R0 question 4) with no setting.
// The probe mod (below) sits in that home's skills folder, as R0's did, and draws every site R2 renders: the AbovePrompt
// band (a Button, an Input, and the Buttons that drive the other questions), SessionMode and PromptHint (Text), Spinner
// (Text), and a Pane it opens when a turn completes or a Button is pressed (a Select, a Link, Markdown, Code, an Svg, and
// Buttons that move the pane's focus ring and scroll it). Its presses call `$.ui.invalidate`, `$.prompt.read`,
// `$.prompt.fill`, `$.prompt.suggest` and `$.ui.copy` and log what each resolved to, so every recording says what the
// engine made of the surface's answers. Each scenario attaches as MAWS will (surface "desktop", client id `maws-main`,
// the four answers), reads the pane roster, asks the sites in the order the app asks them, and answers the engine's
// requests from its handlers.
import {launch,removeRun,initPayload,success,check,endAsStop,summarize,uiPushes,uiRequestsIn,PROMPT,delay} from './mods-common.mjs';
import {scratch} from '../../harness.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
export {success,check,endAsStop,summarize,uiPushes,uiRequestsIn,PROMPT,delay,removeRun};

export const PROVENANCE={child:'C2',pin:'82ffd54a295ebd389f5e271010b5e907a8d1d016',spike:'R2',document:'docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md',study:'docs/doperpowers/evidence/ux-2026-10-01/r6-claude-mods.txt'};
export const CLIENT='maws-main';
// `isFullscreen` says the surface docks a pane beside the transcript, as MAWS's panel does: 2.1.287 seats a pane only on
// a client whose attach viewport carries it (`Oun`, "no attached surface places panes" otherwise; this run's first try).
export const VIEWPORT={columns:100,rows:30,isFullscreen:true};
export const ANSWERS=['ui_copy','ui_prompt_read','ui_prompt_fill','ui_prompt_suggest'];
export const PANE='mods-probe-pane';

const MOD_NAME='mods-probe';
const MOD_FILES={
 '.claude-plugin/plugin.json':JSON.stringify({name:MOD_NAME,version:'0.2.0',description:'MAWS R2 probe: every desktop site R2 draws, a pane, presses, inputs, a pick, and the requests a surface answers'},null,1)+'\n',
 'hooks/hooks.json':JSON.stringify({modules:['./register.tsx']})+'\n',
 'hooks/register.tsx':`// MAWS R2 probe mod (spikes/protocol-probe/scenarios/pass3/mods-surface-common.mjs)
const PANE = '${PANE}'
let presses = 0
let typed = ''
let submitted = ''
let picked = 'one'
let opened = 0
const json = value => { try { return JSON.stringify(value) } catch (error) { return String(error) } }
const attempt = async ($, label, run) => {
  try { $.ui.log(label + ' ' + json(await run())) } catch (error) { $.ui.log(label + ' threw ' + String(error && error.message || error)) }
}
const openPane = async ($, why) => {
  opened += 1
  await attempt($, 'MODS_PROBE_OPEN ' + why, () => $.ui.open({ id: PANE, title: 'Probe pane' }))
}
export const register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (opened === 0) await openPane($, 'turn')
    return result
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>{\`MODS_PROBE_BAND presses=\${presses} typed=\${typed} submitted=\${submitted} working=\${e.props.isWorking}\`}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="press" label="Press" variant="primary" onPress={() => { presses += 1; $.ui.log('MODS_PROBE_PRESS ' + presses); $.ui.invalidate('ui.render') }} />
          <Input key="reply" label="Reply" placeholder="Type here" value={typed} submitLabel="Send" onInput={value => { typed = value; $.ui.log('MODS_PROBE_INPUT ' + value) }} onSubmit={value => { submitted = value; $.ui.log('MODS_PROBE_SUBMIT ' + value); $.ui.invalidate('ui.render') }} />
          <Button key="open-pane" label="Open pane" onPress={() => openPane($, 'press')} />
          <Button key="prompt" label="Prompt" onPress={async () => {
            await attempt($, 'MODS_PROBE_READ', () => $.prompt.read())
            await attempt($, 'MODS_PROBE_FILL', () => $.prompt.fill({ text: 'MODS_PROBE_FILL', mode: 'replace' }))
            await attempt($, 'MODS_PROBE_SUGGEST', () => $.prompt.suggest({ text: 'MODS_PROBE_SUGGEST' }))
          }} />
          <Button key="copy" label="Copy" onPress={() => attempt($, 'MODS_PROBE_COPIED', () => $.ui.copy({ text: 'MODS_PROBE_COPY', surface: e.surface }))} />
        </Box>
      </Box>
    )
  })
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'MODS_PROBE_MODE modes=' + e.props.modes.length}</Text>
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{\`MODS_PROBE_HINT draft=\${e.props.isDraft} working=\${e.props.isWorking}\`}</Text>
  })
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{\`MODS_PROBE_SPIN \${e.props.word} \${e.props.mode}\`}</Text>
  })
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Select, Link, Markdown, Code, Svg } = $.ui.resolve(e)
    const rows = Array.from({ length: 12 }, (_, i) => <Text>{'MODS_PROBE_PANE_ROW ' + i}</Text>)
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{\`MODS_PROBE_PANE picked=\${picked} focused=\${e.props.isFocused} placement=\${e.props.placement}\`}</Text>
        <Select key="pick" label="Pick" value={picked} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} onSelect={value => { picked = value; $.ui.log('MODS_PROBE_SELECT ' + value); $.ui.invalidate('ui.render') }} />
        <Link href="https://example.com/mods-probe" label="Probe link" />
        <Markdown text={'**MODS_PROBE_MD** with [a link](https://example.com/md)'} />
        <Code source={'const probe = 1'} language="ts" />
        <Svg source={'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#888"/></svg>'} alt="Probe dot" width={16} height={16} />
        <Box flexDirection="row" gap={1}>
          <Button key="focus" label="Focus pick" onPress={() => attempt($, 'MODS_PROBE_FOCUS', () => $.ui.focus({ requestId: PANE, key: 'pick' }))} />
          <Button key="scroll" label="Scroll to end" onPress={() => attempt($, 'MODS_PROBE_SCROLL', () => $.ui.scroll({ to: 'end', in: PANE }))} />
          <Button key="close" label="Close" role="dismiss" onPress={() => attempt($, 'MODS_PROBE_CLOSE', () => $.ui.close({ id: PANE }))} />
        </Box>
        {rows}
      </Box>
    )
  })
}
`,
};

// A scratch run as R0's (mods-common.mjs scratchRun), the R2 mod in the skills folder.
export function scratchRun(label){
 const root=realpathSync(mkdtempSync(`/tmp/maws-r2-${label}-`));
 const home=join(root,'config');mkdirSync(home);
 const cwd=realpathSync(scratch(join(root,'repo-')));
 writeFileSync(join(home,'settings.json'),'{}\n');
 writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}})+'\n');
 const dir=join(home,'skills',MOD_NAME);
 for(const [rel,text] of Object.entries(MOD_FILES)){mkdirSync(join(dir,rel,'..'),{recursive:true});writeFileSync(join(dir,rel),text);}
 return {root,home,cwd,debugFile:join(root,'debug.log')};
}

// The sites' props as the app asks them (Desktop's shapes where Desktop draws the site, c95e4d2cf-BLkI1oZK.js:8689-8691,
// 9934-9941, 10017-10024, 10352-10358; PromptHint, which Desktop does not draw, from the engine's RenderPropsOf).
export const SITES={
 band:(isWorking=false)=>({component:'AbovePrompt',instance_id:'above-prompt',props:{hasSurvey:false,isWorking,maxRows:12,bodyColumns:VIEWPORT.columns,scroll:{offset:0,bodyRows:12},view:{}}}),
 mode:()=>({component:'SessionMode',instance_id:'session-mode',props:{modes:[]}}),
 hint:(isWorking=false)=>({component:'PromptHint',instance_id:'prompt-hint',props:{isDraft:false,isWorking,hint:''}}),
 spinner:()=>({component:'Spinner',instance_id:'main',props:{word:'Working',message:null,suffix:'…',mode:'requesting'}}),
 pane:(isFocused=false)=>({component:'Pane',instance_id:PANE,props:{title:'Probe pane',isFocused,bodyColumns:60,placement:'dock',scroll:{offset:0,bodyRows:20},view:{}}}),
};

// One ui_render as the app sends it, the answer noted under `label`.
export async function render(p,site,label){
 const response=await p.request('ui_render',{surface:'desktop',client_id:CLIENT,...site,viewport:VIEWPORT});
 p.note({event:'ui_render_answer',label,component:site.component,instance_id:site.instance_id,response});
 return response;
}
// A press, input, pick or other ask by subtype, its answer noted.
export async function ask(p,subtype,payload,label){
 const response=await p.request(subtype,payload);
 p.note({event:subtype+'_answer',label,response});
 return response;
}
// The element a tree carries under `key` (the press handle for a Button, Input or Select).
export function element(tree,key){
 if(!tree||typeof tree!=='object')return null;
 if(tree.props?.key===key&&tree.press)return tree;
 for(const child of tree.children??[]){const found=element(child,key);if(found)return found;}
 return null;
}
// The next system push of `subtype` after the probe's seq `after`.
export const push=(p,subtype,after,timeout=15000)=>p.wait(f=>f.type==='system'&&f.subtype===subtype,{after,timeout});
// The engine's log lines from the probe mod after seq `after`.
export const logs=(p,after=0)=>p.frames.filter(r=>r.seq>after&&r.frame.type==='system'&&r.frame.subtype==='ui_log').map(r=>r.frame.text);

// One launch of the R2 mod: initialize, attach as MAWS attaches, read the roster; `body` gets the probe and the
// initialize answer. Answers the engine's surface requests from `answers` (subtype to payload), noting each.
export async function surfaceRun(name,question,answers,body){
 const run=scratchRun(name.replace(/^mods-surface-/,''));
 try{
  return await launch(name,run,{provenance:{...PROVENANCE,question}},async p=>{
   for(const [subtype,payload] of Object.entries(answers)){
    p.on(subtype,request=>{p.note({event:'ui_request_answered',subtype,request,answer:payload});return payload;});
   }
   const init=success(await p.init(initPayload(run.cwd)),'initialize');
   p.note({event:'initialize_capabilities',capabilities:init.capabilities??null});
   check(p,'initialize carries ui_surface_v1',(init.capabilities??[]).includes('ui_surface_v1'),init.capabilities);
   const attach=await ask(p,'ui_attach',{surface:'desktop',client_id:CLIENT,viewport:VIEWPORT,answers:ANSWERS},'attach');
   check(p,'ui_attach succeeded',attach.subtype==='success',attach);
   await ask(p,'ui_panes',{client_id:CLIENT},'roster on attach');
   await body(p,{init,run});
   const s=summarize(p,name);
   check(p,'one turn answered',s.answer!==null);
   await ask(p,'ui_detach',{client_id:CLIENT},'detach');
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

// The no-tools turn, the pushes that trail its result given time to arrive.
export async function turn(p,{during}={}){
 const after=p.seq;
 p.user(PROMPT);
 if(during){await p.wait(f=>f.type==='command_lifecycle'&&f.state==='started',{after});await during();}
 const result=await p.wait(f=>f.type==='result',{after});
 await delay(4000);
 return result;
}
