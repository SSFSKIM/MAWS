import json, sys, time
from pathlib import Path
bus=Path(sys.argv[1]); seen=set()
while True:
 for f in sorted(bus.glob('*.req.json')):
  if f.name not in seen:
   r=json.loads(f.read_text());seen.add(f.name)
   print(json.dumps(r),flush=True)
 time.sleep(.05)
