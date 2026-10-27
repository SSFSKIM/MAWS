import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
for name,method,kind in [('exit-bg-confirmed','exit-confirm','background'),('term-panel','term','panel'),('term-confirm','term','confirm'),('exit-empty','exit','empty'),('term-seeded','term','seed'),('exit-seeded','exit','seed')]:
 p=Probe(name,allow=kind!='confirm')
 try:
  if kind=='background':
   cmd=f"echo $$ > {p.root}/shell.pid; trap 'echo TERM >> {p.root}/shell.signals; exit 0' TERM; trap 'echo HUP >> {p.root}/shell.signals; exit 0' HUP; while :; do date +%s >> {p.root}/heartbeat; sleep 0.25; done"
   r=p.req('tool',input={'tool':'Bash','command':cmd,'description':'Probe background heartbeat','run_in_background':True});print(name,'tool',p.result(r),flush=True)
   p.pump(.7)
   (p.root/'before-stop.raw').write_bytes(p.buf)
  elif kind=='panel':
   p.type('/usage');p.pump(2);(p.root/'before-stop.raw').write_bytes(p.buf)
  elif kind=='seed':
   p.type('! printf TRANSCRIPT_FINAL_SENTINEL')
   p.wait(lambda:b'TRANSCRIPT_FINAL_SENTINEL' in p.buf,5);p.pump(2)
   (p.root/'before-stop.raw').write_bytes(p.buf)
  elif kind=='confirm':
   r=p.req('tool',input={'tool':'Bash','command':f'echo confirmed > {p.root}/confirmed','description':'Probe permission confirmation'})
   p.pump(2);(p.root/'before-stop.raw').write_bytes(p.buf)
  p.stop(method)
  if kind=='background':
   pid=int((p.root/'shell.pid').read_text());alive=True
   try:os.kill(pid,0)
   except ProcessLookupError:alive=False
   (p.root/'background-after.json').write_text(json.dumps({'pid':pid,'alive':alive,'signals':(p.root/'shell.signals').read_text() if (p.root/'shell.signals').exists() else None}))
   print(name,'shell-alive',alive,flush=True)
   if alive:os.kill(pid,15)
 finally:p.cleanup()
