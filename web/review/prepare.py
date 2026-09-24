"""Prepare a private UI run using current production pins; never deploy implicitly."""
import argparse
from pathlib import Path
import re
import yaml

p=argparse.ArgumentParser()
for key in ('base','review-image','recorder-image','run','output'):
    p.add_argument('--'+key,required=True)
p.add_argument('--device', choices=['macbook-air15-m4','pixel6','iphone15'], default='macbook-air15-m4')
p.add_argument('--video', required=True)
p.add_argument('--resume', action='store_true')
p.add_argument('--artifact-prefix', default='')
a=p.parse_args()
if not re.fullmatch('[a-z0-9][a-z0-9_]{0,19}',a.run):
    raise SystemExit('run must use 1–20 lowercase letters, digits or underscores')
if not re.fullmatch('[a-z0-9-]{0,30}',a.artifact_prefix) or (a.resume and not a.artifact_prefix):
    raise SystemExit('Resume requires a new artifact prefix (lowercase letters, digits, hyphens)')
r=yaml.safe_load(Path(a.base).read_text())
# Capability template from the initial authorized review; its production image
# references are deliberately never copied into this run.
previous=yaml.safe_load(Path('web/deploy/preview/ui-review-20260923.yml').read_text())
review=previous['services']['review']
review['image']=a.review_image
review['env']['UI_REVIEW_RUN']=a.run
review['env'].pop('GEMINI_API_KEY_FILE',None)
review['env']['OPENROUTER_API_KEY_FILE']='/run/openrouter/api_key'
review['secrets']=[x for x in review['secrets'] if x['name']!='tarjama-gemini']
review['secrets'].append(dict(name='openrouter',path='/run/openrouter'))
r['services']['review']=review
name='ui-'+a.run.replace('_','-')
r['jobs']={name:dict(image=a.recorder_image,uid=10004,gid=10004,
    command=['node'],args=['/src/frontend/recording/record.mjs'],
    configs=[dict(name='ui-recording',path='/src/frontend/recording')],
    env=dict(REVIEW_DEVICE=a.device,REVIEW_VIDEO=a.video,REVIEW_RESUME='1' if a.resume else '0',REVIEW_ARTIFACT_PREFIX=a.artifact_prefix),
    connect=['review'],resources=dict(cpu='2000m',memory='2048Mi'),
    tmp='1024Mi',timeout=3600)}
r['jobs']['results-'+a.run.replace('_','-')]=dict(image=a.recorder_image,uid=10004,gid=10004,
    command=['node'],args=['/src/frontend/recording/summarize.mjs'],connect=['review'],
    configs=[dict(name='ui-recording',path='/src/frontend/recording')],
    env=dict(REVIEW_ARTIFACT_PREFIX=a.artifact_prefix),
    resources=dict(cpu='100m',memory='128Mi'),tmp='16Mi',timeout=120)
r.setdefault('configs',{})['ui-recording']={name:Path('web/review',name).read_text() for name in ('record.mjs','record-support.mjs','record-export.mjs','summarize.mjs')}
Path(a.output).write_text(yaml.safe_dump(r,allow_unicode=True,sort_keys=False))
print('Prepared job',name,'; no deployment performed')
