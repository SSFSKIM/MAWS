// C10 M1, the trust bootstrap's recorded wire shape (C10 document, Trust, "Trust bootstrap"): an initialize-only launch
// in a fresh untrusted scratch directory, pinned with `--session-id` (the fixture's identity under replay: a no-turn
// launch emits no system/init), attesting `workspaceTrust { accepted: true, directory }`, confirmed by
// `workspace_trust_recorded: true`, then ended as C3's session.stop ends one. No user frame, no system/init row and no
// transcript afterwards; the scratch `.claude.json` records the key.
import {launch,scratchConfigHome,tempDir,initPayload,success,check,endAsStop,trustOf,projectListing,mkdirSync,writeFileSync,join} from './c10-common.mjs';

const RULE='Bash(echo MAWS_C10_BOOTSTRAP:*)';

export default async()=>{
 const dir=tempDir('/tmp/maws-probe3-bootstrap-');
 mkdirSync(join(dir,'.claude'));writeFileSync(join(dir,'.claude','settings.json'),JSON.stringify({permissions:{allow:[RULE]}}));
 const configHome=scratchConfigHome();
 const {p}=await launch('trust-bootstrap-recorded',{cwd:dir,env:{CLAUDE_CONFIG_DIR:configHome}},async(p,{globalConfig})=>{
  p.note({event:'trust_store_before',state:trustOf(globalConfig,[dir])});
  const init=success(await p.init(initPayload({workspaceTrust:{accepted:true,directory:dir}})),'initialize');
  p.note({event:'initialize_trust',attestedDirectory:dir,workspace_trust_recorded:init.workspace_trust_recorded??null});
  check(p,'workspace_trust_recorded is true',init.workspace_trust_recorded===true);
  await endAsStop(p);
  const after=trustOf(globalConfig,[dir]);
  p.note({event:'trust_store_after',state:after});
  check(p,'the scratch global config records the key',after[dir]===true);
  const listing=projectListing(configHome,dir);
  p.note({event:'project_directory_after',...listing});
  check(p,'no transcript was written',listing.entries.filter(e=>e.endsWith('.jsonl')).length===0,listing);
  check(p,'no user frame and no system/init',!p.frames.some(r=>r.frame.type==='user'||(r.frame.type==='system'&&r.frame.subtype==='init')));
 });
 console.log('trust-bootstrap-recorded recorded',p.file);
};
