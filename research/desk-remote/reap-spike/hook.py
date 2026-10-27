import json,os,sys,time
from pathlib import Path
x=json.load(sys.stdin)
bus=Path(os.environ['REAP_BUS'])
with (bus/'classic.jsonl').open('a') as f:f.write(json.dumps({'t':time.time(),**x})+'\n')
if x['hook_event_name']=='UserPromptSubmit':
 c=json.loads((bus/'mode.json').read_text())
 if c.get('classic_delay'):time.sleep(c['classic_delay']/1000)
 if c.get('classic_drop') and not x.get('prompt','').startswith('ALLOW:'):
  print(json.dumps({'decision':'block','reason':'classic-fence-refused'}))
