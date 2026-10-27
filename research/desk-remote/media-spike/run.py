import sys,json,time
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from harness import Probe,wait
p=Probe(sys.argv[1])
try:
 try:p.ready()
 except TimeoutError:
  print(p.pane('startup-timeout'));raise
 print('READY',flush=True)
 print(p.call('queue',id='png',path=str(p.work/'sample.png')),flush=True)
 print(p.call('submit',text='Inspect the bridge upload.'),flush=True)
 p.completed()
 print(p.pane('png'),flush=True)
 print('requests',len(p.stub.requests),flush=True)
finally:p.cleanup()
