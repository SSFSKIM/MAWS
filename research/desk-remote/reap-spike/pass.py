import sys,json,time,os
sys.path.insert(0,'/private/tmp/reap-spike')
from harness import Probe
p=Probe('step-pass')
try:
 p.mode(drop=False,classic_drop=False,delay=3000,step_delay=3000,step_block=False)
 r=p.req('submit',text='PASS_TO_LOCAL_DISABLED_ENDPOINT')
 p.wait(lambda:'[API REQUEST] /v1/messages source=repl_main_thread' in (p.root/'debug.log').read_text(),20)
 print('accepted',p.result(r),flush=True)
 p.stop()
finally:p.cleanup()
