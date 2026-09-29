"""Isolated operational SQL test: no live credentials, network or data."""
import json, subprocess, time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
name='tarjama-reexport-sql-test'
def sql(text, ok=True, args=()):
 r=subprocess.run(['docker','exec','-i',name,'psql','-X','-U','test','-d','test','-v','ON_ERROR_STOP=1',*args],input=text,text=True,capture_output=True)
 if (r.returncode==0)!=ok: raise RuntimeError(r.stderr)
 return r.stdout
subprocess.run(['docker','run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_USER=test','-e','POSTGRES_PASSWORD=test-only','-e','POSTGRES_DB=test','postgres:17-alpine'],check=True,stdout=subprocess.DEVNULL)
try:
 for _ in range(30):
  if subprocess.run(['docker','exec',name,'pg_isready','-U','test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(1)
 sql((root/'web/backend/internal/studio/migrations/001_initial.sql').read_text())
 sql((root/'web/backend/internal/studio/migrations/002_isolated_media.sql').read_text())
 doc={'id':'target','url':'https://www.youtube.com/watch?v=YuV8IY-Bgoc','stage':'ready','version':5,'confirmed_review':5,'generation':1,'segments':[{'arabic':'نعم','french':'Oui.'}]}
 def fixture():
  sql("TRUNCATE users CASCADE; INSERT INTO users(id,issuer,subject) VALUES('owner','test','owner'),('other','test','other'); INSERT INTO projects(id,owner_id,document) VALUES('target','owner','"+json.dumps(doc).replace("'","''")+"'),('other','other','{}'); INSERT INTO jobs(id,project_id,owner_id,kind,source_version,generation,input,state,media_attempt) SELECT 'export',id,owner_id,'export_fr_low',5,1,document,'succeeded',2 FROM projects WHERE id='target';")
 def apply(ok=True,url=doc['url']):return sql((root/'web/deploy/maintenance/reexport.sql').read_text(),ok,args=['-v','project_id=target','-v','expected_url='+url])
 fixture();before=sql('SELECT id,document FROM projects ORDER BY id;');apply();assert before==sql('SELECT id,document FROM projects ORDER BY id;');assert 'queued|3|export_fr_low' in sql("SELECT state||'|'||media_attempt||'|'||kind FROM jobs;")
 apply(False) # The already queued job is not restarted.
 fixture();apply(False,'https://www.youtube.com/watch?v=other');assert 'succeeded' in sql('SELECT state FROM jobs;')
 fixture();sql("UPDATE projects SET document=jsonb_set(document,'{stage}','\"review\"') WHERE id='target';");apply(False)
 fixture();sql("UPDATE projects SET document=jsonb_set(document,'{version}','6') WHERE id='target';");apply(False)
 fixture();sql("INSERT INTO jobs(id,project_id,owner_id,kind,source_version,generation,input,state) VALUES('restore','target','owner','restore_download',5,1,'{}','running');");apply(False)
 fixture();sql("UPDATE jobs SET source_version=4;");apply();assert sql('SELECT count(*) FROM jobs;',args=['-At']).strip()=='2'
 print('PASS: rerender same version, fresh attempt, unchanged documents, active-job exclusion, wrong source, unvalidated review, stale approval, new-version export')
finally:
 subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)
