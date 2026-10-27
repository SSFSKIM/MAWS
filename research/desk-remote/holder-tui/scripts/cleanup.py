import runpy,os,signal,subprocess,json,pathlib,time
p=runpy.run_path('/private/tmp/holder-tui/scripts/probe.py');Env=p['Env'];base=pathlib.Path('/private/tmp/holder-tui');result={'managers':[],'tmux':[],'daemon_jobs':[]}
for name in ['main','timing','plain-full','plain-main','configured','jobcontrol']:
 e=Env(name);subprocess.run(e.tmux+['kill-server'],capture_output=True);result['tmux'].append(name)
 mp=pathlib.Path(e.root+'/manager-pid.json')
 if mp.exists():
  pid=json.loads(mp.read_text())['manager'];cmd=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True).stdout
  if '/private/tmp/holder-tui/scripts/pty_manager.py '+e.root in cmd:
   os.kill(pid,signal.SIGTERM);result['managers'].append(pid)
 if os.path.exists(e.sock):
  try:
   for j in e.control('list').get('jobs',[]):result['daemon_jobs'].append([name,j['short'],e.control('kill',short=j['short'])])
  except (OSError,TimeoutError):pass
# Credential files are probe inputs, not retained evidence.
secrets=[os.environ[k].encode() for k in ['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY'] if os.environ.get(k)]
removed=[];redacted=[]
for f in base.rglob('*'):
 if not f.is_file() or f.is_symlink():continue
 try:d=f.read_bytes()
 except OSError:continue
 if f.name=='env':f.unlink();removed.append(str(f));continue
 if any(s in d for s in secrets):
  for s in secrets:d=d.replace(s,b'[REDACTED-PROBE-CREDENTIAL]')
  f.write_bytes(d);redacted.append(str(f))
result['removed_env_files']=removed;result['redacted_files']=redacted
result['remaining_secret_matches']=[]
for f in base.rglob('*'):
 if f.is_file() and not f.is_symlink():
  try:
   if any(s in f.read_bytes() for s in secrets):result['remaining_secret_matches'].append(str(f))
  except OSError:pass
json.dump(result,open(base/'cleanup.json','w'),indent=2);print(json.dumps(result,indent=2))
