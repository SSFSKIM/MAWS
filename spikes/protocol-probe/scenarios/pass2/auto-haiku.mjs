// Item 13: --permission-mode auto with a model that lacks auto support (haiku) falls back silently; no model turn.
import {run,initPayload} from './common.mjs';
export default ()=>run('auto-haiku',async p=>{const r=await p.request('initialize',initPayload());p.note({event:'init_summary',current_permission_mode:r.response?.current_permission_mode,permission_mode_from_default_fallback:r.response?.permission_mode_from_default_fallback??null});
 const m=await p.request('set_permission_mode',{mode:'auto'});p.note({event:'mode_result',requested:'auto',subtype:m.subtype,error_code:m.error_code??null});},{model:'haiku'});
