import json,pathlib,hashlib
ROOT=pathlib.Path('/private/tmp/wave2-trunc')
def requests(name):
 return [(f.name,json.loads(f.read_text())['body']) for f in sorted((ROOT/name/'http').glob('request-*.json'))]
def blocks(value,kind):
 out=[]
 if isinstance(value,dict):
  if value.get('type')==kind:out.append(value)
  for v in value.values():out.extend(blocks(v,kind))
 elif isinstance(value,list):
  for v in value:out.extend(blocks(v,kind))
 return out
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def usertext(b):return json.dumps([m for m in b.get('messages',[]) if m['role']=='user'])
a={}
main=[(n,b) for n,b in requests('basic') if b.get('tools')]
a['basic_active']={'file':main[-2][0],'kept':'KEEP_ALPHA' in usertext(main[-2][1]),'dropped_beta':'DROP_BETA' in usertext(main[-2][1]),'dropped_gamma':'DROP_GAMMA' in usertext(main[-2][1])}
a['basic_resumed']={'file':main[-1][0],'kept':'KEEP_ALPHA' in usertext(main[-1][1]),'dropped_beta':'DROP_BETA' in usertext(main[-1][1]),'dropped_gamma':'DROP_GAMMA' in usertext(main[-1][1]),'assistant_blocks':[m['content'] for m in main[-1][1]['messages'] if m['role']=='assistant']}
media=[(n,b) for n,b in requests('media') if b.get('tools')]
for kind in ['thinking','image']:
 old=blocks(media[-2][1]['messages'],kind);new=blocks(media[-1][1]['messages'],kind)
 a['media_'+kind]={'before':media[-2][0],'after':media[-1][0],'equal':old==new,'count':len(old),'before_sha256':digest(old),'after_sha256':digest(new)}
for route in ['guard','self']:
 rs=[(n,b) for n,b in requests('resume-'+route) if b.get('tools')]
 a['resume_'+route]={'active':rs[-2][0],'resumed':rs[-1][0],'active_thinking_count':len(blocks(rs[-2][1]['messages'],'thinking')),'resumed_thinking_count':len(blocks(rs[-1][1]['messages'],'thinking')),'active_text_count':sum(x.get('text')=='RETAIN_ASSISTANT' for x in blocks(rs[-2][1]['messages'],'text')),'resumed_text_count':sum(x.get('text')=='RETAIN_ASSISTANT' for x in blocks(rs[-1][1]['messages'],'text'))}
for name in ['basic','bound-0','bound-1','media','pair','queued','effects','ordinary']:
 es=[json.loads(f.read_text()) for f in (ROOT/name/'bus/events').glob('*.json')]
 es.sort(key=lambda x:x['t'])
 a[name+'_compact_hooks']=[{'event':e['event'],'trigger':e['data'].get('trigger'),'instructions':e['data'].get('instructions')} for e in es if 'compact' in e['event']]
 a[name+'_classic_compact_hooks']=[e['data'] for e in es if e['event']=='classic' and (e['data'].get('hook_event_name') in ['PreCompact','PostCompact'] or e['data'].get('source')=='compact')]
a['pair_last_request']=next(b for n,b in reversed(requests('pair')) if b.get('tools'))['messages'][-2:]
a['background_requests']=[{'file':n,'contains_done':'BG_DONE' in json.dumps(b.get('messages',[])),'contains_task_notification':'task-notification' in json.dumps(b.get('messages',[]))} for n,b in requests('effects') if b.get('tools')]
for name,marker in [('resume-partial','SHOULD_BE_CUT_ASSISTANT_TEXT'),('resume-pair','SHOULD_BE_CUT_TOOL_RESULT')]:
 rs=[(n,b) for n,b in requests(name) if b.get('tools')]
 a[name]={'active_file':rs[-2][0],'resumed_file':rs[-1][0],'marker_in_active':marker in json.dumps(rs[-2][1]['messages']),'marker_in_resumed':marker in json.dumps(rs[-1][1]['messages'])}
typing=next((n,b) for n,b in reversed(requests('typing')) if b.get('tools'))
a['typing']={'request_file':typing[0],'draft_present_in_pane':'DRAFT_BEFORE_TYPED_DURING_CUT' in (ROOT/'typing/pane-after.txt').read_text(),'draft_submitted_in_next_request':'DRAFT_BEFORE_TYPED_DURING_CUT' in str(typing[1]['messages']),'dropped_tail_absent':'DROP_TYPING_TAIL' not in str(typing[1]['messages'])}
(ROOT/'audit.json').write_text(json.dumps(a,indent=2,ensure_ascii=False));print(json.dumps({k:v for k,v in a.items() if 'hooks' not in k and k!='pair_last_request'},indent=2,ensure_ascii=False))
