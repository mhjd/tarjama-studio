"""Prepare a private UI run using current production pins; never deploy implicitly."""
import argparse
from pathlib import Path
import re
import yaml

p=argparse.ArgumentParser()
for key in ('base','review-image','recorder-image','run','output'):
    p.add_argument('--'+key,required=True)
a=p.parse_args()
if not re.fullmatch('[a-z0-9][a-z0-9_]{0,19}',a.run):
    raise SystemExit('run must use 1–20 lowercase letters, digits or underscores')
r=yaml.safe_load(Path(a.base).read_text())
# Capability template from the initial authorized review; its production image
# references are deliberately never copied into this run.
previous=yaml.safe_load(Path('web/deploy/preview/ui-review-20260923.yml').read_text())
review=previous['services']['review']
review['image']=a.review_image
review['env']['UI_REVIEW_RUN']=a.run
r['services']['review']=review
name='ui-'+a.run.replace('_','-')
r['jobs']={name:dict(image=a.recorder_image,uid=10004,gid=10004,
    command=['node'],args=['/src/frontend/recording/record.mjs'],
    configs=[dict(name='ui-recording',path='/src/frontend/recording')],
    connect=['review'],resources=dict(cpu='2000m',memory='2048Mi'),
    tmp='1024Mi',timeout=3600)}
r['jobs']['results-'+a.run.replace('_','-')]=dict(image=a.recorder_image,uid=10004,gid=10004,
    command=['node'],args=['/review/summarize.mjs'],connect=['review'],
    resources=dict(cpu='100m',memory='128Mi'),tmp='16Mi',timeout=120)
r.setdefault('configs',{})['ui-recording']={name:Path('web/review',name).read_text() for name in ('record.mjs','record-support.mjs')}
Path(a.output).write_text(yaml.safe_dump(r,allow_unicode=True,sort_keys=False))
print('Prepared job',name,'; no deployment performed')
