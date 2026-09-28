// Item 2 follow-up: with user settings loaded, does an unrouted process env stay unrouted? No model turn.
import {run,initPayload} from './common.mjs';
const status=async(p,label)=>{const r=await p.request('get_status',{});const rows=(r.response?.sections||[]).flatMap(s=>s.rows||[]);p.note({event:'routing',label,baseUrl:rows.find(x=>/base URL/i.test(x.label))?.value??null,auth:rows.find(x=>/Auth token|Login/i.test(x.label))?.value??null});};
export default async()=>{
 await run('routing-user-settings',async p=>{await p.request('initialize',initPayload());await status(p,'unrouted env, user settings');},{unrouted:true,settingSources:'user',model:'sonnet'});
 await run('routing-flag-override',async p=>{await p.request('initialize',initPayload());await status(p,'unrouted env, user settings, flag env override');},{unrouted:true,settingSources:'user',model:'sonnet',flags:['--settings',JSON.stringify({env:{ANTHROPIC_BASE_URL:'',ANTHROPIC_AUTH_TOKEN:''}})]});
};
