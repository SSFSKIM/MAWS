"""Independent wire/transcript checks of the measured media spike (no engine launch)."""
import json,base64,hashlib,subprocess
from pathlib import Path
BASE=Path('/private/tmp/wave2-media')
checks=[]
def check(name,condition,**evidence):
 assert condition,name
 checks.append(dict(check=name,**evidence))
def load(case,name):return json.loads((BASE/case/name).read_text())
def events(case,kind):
 rows=[json.loads(p.read_text()) for p in (BASE/case/'bus/events').glob('*.json')]
 return sorted([r for r in rows if r['ev']==kind],key=lambda r:r['t'])
def rows(case):
 return [json.loads(l) for p in (BASE/case/'home/.claude/projects').glob('*/*.jsonl') for l in p.read_text().splitlines()]
def requests(case):return [json.loads(f.read_text()) for f in sorted((BASE/case).glob('request-*.json'))]
def results(req):
 return {b['tool_use_id']:b for m in req['body']['messages'] if isinstance(m['content'],list) for b in m['content'] if b['type']=='tool_result'}
def media(req,id):return [b for b in results(req).get(id,{}).get('content',[]) if isinstance(b,dict) and b['type'] in ('image','document')]
def transcript_uses(case):return [b for r in rows(case) if r.get('type')=='assistant' for b in r['message']['content'] if b['type']=='tool_use']
def main_requests(case):return [r for r in requests(case) if r['body'].get('tools')]

r=requests('formats1')
for i,id,ext,typ,mime in [(0,'bridge_upload','png','image','image/png'),(1,'bridge_pdf','pdf','document','application/pdf')]:
 block=media(r[i],id)[0];raw=base64.b64decode(block['source']['data']);fixture=(BASE/'formats1/work'/('sample.'+ext)).read_bytes()
 check(ext+' native content is present and byte-exact',block['type']==typ and block['source']['media_type']==mime and raw==fixture,request=str(BASE/'formats1'/f'request-{i+1:03d}.json'),sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
b=media(r[2],'bridge_pdf-pages')[0]
check('PDF pages renders JPEG instead of document',b['type']=='image' and b['source']['media_type']=='image/jpeg' and base64.b64decode(b['source']['data']).startswith(b'\xff\xd8'))
check('duplicate upload ID executes exactly once',load('formats1','duplicate.json')['value']=={'duplicate':'upload'} and len([u for u in transcript_uses('formats1') if u['id']=='bridge_upload'])==1)
check('step re-enters after every synthetic Read', [e['input']['index'] for e in events('formats1','step.enter')]==[0,1]*5)
check('cwd media reads need no permission dialog',not events('formats1','permission'))
rs=rows('formats1');synthetic=[r for r in rs if r.get('type')=='assistant' and r.get('answeredWithoutRequest')]
check('synthetic assistant provenance stamps',len(synthetic)==10 and all(r['isUnmetered'] and r['message']['id'].startswith('msg_hook_') for r in synthetic))
check('text prelude is visible', '[Bridge-requested upload' in (BASE/'formats1/result-pane.txt').read_text())
check('user note has plugin origin',any(r.get('isMeta') and r.get('origin',{}).get('name')=='media-probe' for r in rs))
notes=requests('notes-only1')
check('user note enters request; system note does not', 'Bridge-requested upload user-only' in json.dumps(notes[1]['body']['messages']) and 'Bridge-requested upload system-only' not in json.dumps(notes[1]['body']['messages']))
check('neither append note is visible in ordinary TUI','Bridge-requested upload' not in (BASE/'notes-only1/system-note-pane.txt').read_text())
check('system note is persisted',any(r.get('type')=='system' and 'Bridge-requested upload system-only' in str(r.get('content','')) for r in rows('notes-only1')))
check('outside cwd asks in default mode',events('outside-ask1','permission')[0]['input']['permission_mode']=='default' and 'Do you want to proceed?' in (BASE/'outside-ask1/permission-screen.txt').read_text() and not requests('outside-ask1'))
check('same plugin permission hook allows engine Read',bool(media(requests('outside-allow1')[0],'bridge_upload')) and any(r.get('permissionDecision',{}).get('source')=='hook' for r in rows('outside-allow1')))
check('detached direct call skips same plugin permission hook',not events('direct-origin2','permission') and 'classic.PermissionRequest skipped: re-entry' in (BASE/'direct-origin2/debug.log').read_text() and 'Do you want to proceed?' in (BASE/'direct-origin2/permission-screen.txt').read_text())
check('plugin prompt really has detached origin','prompt.submit skipped: re-entry (the plugin\'s own code raised it; origin media-probe)' in (BASE/'formats1/debug.log').read_text())
check('result-only toolUses executes nothing',not requests('negative1') and not transcript_uses('negative1') and not events('negative1','tool.call'))
check('literal @path does not attach media',not transcript_uses('literal1') and not any('image'==b.get('type') or 'document'==b.get('type') for m in requests('literal1')[0]['body']['messages'] if isinstance(m['content'],list) for b in m['content']))
mt=events('mid-tool2','tool.result');bashdone=next(e['t'] for e in mt if e['tool']=='Bash');claim=events('mid-tool2','step.claim')[0]['t'];queue=load('mid-tool2','queue-mid-tool.json')['t'];wire=requests('mid-tool2')[1]['t']*1000
check('mid-tool waits until Bash completes and uses same turn',queue<bashdone<claim<wire and [e['input']['index'] for e in events('mid-tool2','step.enter')]==[0,1,2] and bool(media(requests('mid-tool2')[1],'bridge_upload')),queue_to_claim_ms=claim-queue,bash_result_to_claim_ms=claim-bashdone,queue_to_wire_ms=round(wire-queue,1))
check('inflight end-turn response leaves upload pending',load('mid-model2','after-first.json')['claims']==[] and len(main_requests('mid-model2'))==2 and not media(requests('mid-model2')[0],'bridge_upload') and bool(media(requests('mid-model2')[1],'bridge_upload')))
check('inflight tool-use response resumes into intake',len(events('mid-model-tool1','turn.complete'))==1 and [e['input']['index'] for e in events('mid-model-tool1','step.enter')]==[0,1,2] and bool(media(requests('mid-model-tool1')[1],'bridge_upload')))
for case in ['esc-step1','esc-step-chunks1']:
 a=load(case,'after-esc.json')
 check(case+' cancels incomplete synthetic response',not a['tools'] and a['requests']==0 and not any(u['id']=='bridge_upload' for u in transcript_uses(case)) and any(r.get('message',{}).get('content')==[{'type':'text','text':'user-cancel'}] for r in rows(case)))
for case in ['esc-step-chunks1','esc-model2']:
 check(case+' latch blocks prompt but not read-only call or note', 'drop' in load(case,'late-submit.json')['value'] and load(case,'late-append.json')['value']['message']['isMeta'] and load(case,'late-tool.json')['value']['result']['type']=='image')
check('Esc following model request keeps media for resumed turn',bool(media(main_requests('esc-model2')[0],'bridge_upload')) and bool(media(main_requests('esc-model2')[-1],'bridge_upload')) and len(transcript_uses('esc-model2'))==1)
f=requests('fallback1')
check('fallback first request text only; cooperative Read supplies same PNG and PDF',not results(f[0]) and bool(media(f[1],'stub_read_png')) and bool(media(f[3],'stub_read_pdf')) and not events('fallback1','permission'))
ps=subprocess.run(['/bin/ps','-axo','pid,ppid,command'],capture_output=True,text=True,check=True).stdout
live=[line for line in ps.splitlines() if '/private/tmp/wave2-media/' in line or 'tmux -L wave2-media-' in line]
check('no spike process remains',not live)
roots=[p for p in BASE.iterdir() if p.is_dir() and (p/'cleanup.json').exists()]
check('no isolated env files remain',all(not (p/'env').exists() for p in roots),runs=len(roots))
check('no isolated daemon socket remains',all(not (Path(load(p.name,'cleanup.json')['daemonRoot'])/'control.sock').exists() for p in roots))
output={'build':'2.1.310','passed':len(checks),'checks':checks}
out=Path(__file__).parent/'audit.json';out.write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output,indent=2))
