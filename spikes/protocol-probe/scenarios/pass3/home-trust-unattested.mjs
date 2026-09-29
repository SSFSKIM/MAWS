// C10 M1 review, the control for home-trust-session-only: the same initialize-only pinned launch with HOME and the cwd
// one temporary directory and CLAUDE_CONFIG_DIR at $HOME/.claude, but unattested. Recorded: no
// `workspace_trust_recorded`, the sentinel in `$HOME/.claude/settings.local.json` loaded anyway (with the cwd at HOME the
// project and local settings files sit inside the config home), and no trust notice on stderr: under ~ the attestation
// changes nothing `list_permission_rules` shows, which is what the home card's copy must say.
import {launch,tempDir,initPayload,success,check,endAsStop,stderrText,trustOf,mkdirSync,writeFileSync,join} from './c10-common.mjs';

const RULE='Bash(echo MAWS_C10_HOME:*)';

export default async()=>{
 const home=tempDir('/tmp/maws-probe3-home-');
 const configHome=join(home,'.claude');
 mkdirSync(configHome);writeFileSync(join(configHome,'settings.json'),'{}\n');
 writeFileSync(join(configHome,'settings.local.json'),JSON.stringify({permissions:{allow:[RULE]}}));
 const {p}=await launch('home-trust-unattested',{cwd:home,env:{HOME:home,CLAUDE_CONFIG_DIR:configHome}},async(p,{globalConfig})=>{
  p.note({event:'trust_store_before',state:trustOf(globalConfig,[home])});
  const init=success(await p.init(initPayload()),'initialize');
  check(p,'the initialize response carries no workspace_trust_recorded',!('workspace_trust_recorded' in init));
  const rules=success(await p.request('list_permission_rules',{}),'list_permission_rules');
  const loaded=JSON.stringify(rules).includes('MAWS_C10_HOME');
  p.note({event:'rule_check',hasSentinel:loaded,sentinelFile:join(configHome,'settings.local.json')});
  check(p,'the sentinel loads without an attestation',loaded);
  await endAsStop(p);
  check(p,'no trust notice was printed',!/this workspace has not been trusted/.test(stderrText(p)));
  p.note({event:'trust_store_after',state:trustOf(globalConfig,[home])});
  check(p,'the home key is not recorded',trustOf(globalConfig,[home])[home]!==true);
  check(p,'no user frame and no system/init',!p.frames.some(r=>r.frame.type==='user'||(r.frame.type==='system'&&r.frame.subtype==='init')));
 });
 console.log('home-trust-unattested recorded',p.file);
};
