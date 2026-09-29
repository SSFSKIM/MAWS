// C10 M1, the home directory's session-only trust (C10 document, Trust, "The home directory"): the same initialize-only
// pinned launch with HOME and the cwd one temporary directory (the engine's homedir() is HOME), CLAUDE_CONFIG_DIR at
// $HOME/.claude. Expected: `workspace_trust_recorded: false` (cli.pretty.js 726129-726139: `session_only`). Then
// `list_permission_rules` records what the session-only flag loaded, which decides the home card's copy: the sentinel
// sits in `$HOME/.claude/settings.local.json`, the project-local layer of a session whose cwd is HOME (its
// `.claude/settings.json` is the user layer there, which trust never gates).
import {launch,tempDir,initPayload,success,check,endAsStop,stderrText,trustOf,projectListing,mkdirSync,writeFileSync,join} from './c10-common.mjs';

const RULE='Bash(echo MAWS_C10_HOME:*)';

export default async()=>{
 const home=tempDir('/tmp/maws-probe3-home-');
 const configHome=join(home,'.claude');
 mkdirSync(configHome);writeFileSync(join(configHome,'settings.json'),'{}\n');
 writeFileSync(join(configHome,'settings.local.json'),JSON.stringify({permissions:{allow:[RULE]}}));
 const {p}=await launch('home-trust-session-only',{cwd:home,env:{HOME:home,CLAUDE_CONFIG_DIR:configHome}},async(p,{globalConfig})=>{
  p.note({event:'trust_store_before',state:trustOf(globalConfig,[home])});
  const init=success(await p.init(initPayload({workspaceTrust:{accepted:true,directory:home}})),'initialize');
  p.note({event:'initialize_trust',attestedDirectory:home,workspace_trust_recorded:init.workspace_trust_recorded??null});
  check(p,'workspace_trust_recorded is false',init.workspace_trust_recorded===false);
  const rules=success(await p.request('list_permission_rules',{}),'list_permission_rules');
  const loaded=JSON.stringify(rules).includes('MAWS_C10_HOME');
  p.note({event:'rule_check',hasSentinel:loaded,sentinelFile:join(configHome,'settings.local.json')});
  await endAsStop(p);
  p.note({event:'trust_notice',printed:/this workspace has not been trusted/.test(stderrText(p))});
  p.note({event:'trust_store_after',state:trustOf(globalConfig,[home])});
  check(p,'the home key is not recorded',trustOf(globalConfig,[home])[home]!==true);
  const listing=projectListing(configHome,home);
  p.note({event:'project_directory_after',...listing});
  check(p,'no user frame and no system/init',!p.frames.some(r=>r.frame.type==='user'||(r.frame.type==='system'&&r.frame.subtype==='init')));
 });
 console.log('home-trust-session-only recorded',p.file);
};
