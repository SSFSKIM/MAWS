import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
for method in ('term','exit'):
 p=Probe('transcript-'+method)
 try:
  p.mode(drop=False,classic_drop=False,step_block=True)
  p.type('FINAL_DURABILITY_'+method)
  p.wait(lambda:any(e['ev']=='turn.complete' for e in p.events()))
  result=p.result(p.req('messages'))
  (p.root/'messages-before.json').write_text(json.dumps(result,indent=2))
  p.stop(method)
  f=next((p.cfg/'projects').glob('*/*.jsonl'));rows=[json.loads(x) for x in f.read_text().splitlines()]
  print(method,'rows',len(rows),'messages',[(r.get('role'),r.get('text'),r.get('id')) for r in result.get('value',[])][-5:],flush=True)
 finally:p.cleanup()
