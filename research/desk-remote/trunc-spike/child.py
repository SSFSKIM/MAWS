import sys,time,json
from pathlib import Path
bus=Path(sys.argv[1]); seen=set()
while True:
 for p in sorted(bus.glob('*.req.json')):
  if p.name in seen or Path(str(p)+'.res').exists(): continue
  seen.add(p.name)
  try: print(json.dumps(dict(json.loads(p.read_text()),file=str(p))),flush=True)
  except Exception: pass
 time.sleep(.05)
