import sys,json
sys.path.insert(0,'/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
from harness import Probe
p=Probe('typing')
try:
 p.ready();p.turn('KEEP_TYPING_BASE');p.turn('DROP_TYPING_TAIL');p.type('DRAFT_BEFORE',enter=False);p.wait(lambda:'DRAFT_BEFORE' in p.pane())
 req=p.req('compact',instructions='CUT:guard:2:1200')
 p.wait(lambda:any(e['event']=='guard.compact' for e in p.events()));p.type('_TYPED_DURING_CUT',enter=False)
 r=p.result(req);(p.root/'cut.json').write_text(json.dumps(r,indent=2));p.wait(lambda:'DRAFT_BEFORE_TYPED_DURING_CUT' in p.pane());(p.root/'pane-after.txt').write_text(p.pane())
 p.keys('Enter');p.wait(lambda:sum(e['event']=='turn.complete' for e in p.events())>=3)
 print('typing draft survived and was submitted',flush=True)
finally:p.cleanup()
