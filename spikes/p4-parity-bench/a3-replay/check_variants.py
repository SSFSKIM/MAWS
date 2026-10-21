import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import replay
g = vars(replay)
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'variants.py')).read(), g)
src = sys.argv[1]
for v in sys.argv[2:] or list(replay.VARIANTS):
    body, betas = replay.request_body(src, 2)
    b, bt = replay.VARIANTS[v](body, betas)
    print(v, len(json.dumps(b)), 'tools', len(b['tools']), [(m['role'], [c.get('type') for c in m['content']] if isinstance(m['content'], list) else 'str') for m in b['messages']][-4:])
