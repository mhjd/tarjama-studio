#!/usr/bin/env python3
"""Generate a stopped candidate; never edit/apply the live recipe or create secrets."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
import yaml

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--images', required=True, help='JSON with imported web, worker and keycloak image references')
p.add_argument('--app-origin', required=True)
p.add_argument('--identity-origin', required=True)
p.add_argument('--admin-origin', required=True)
p.add_argument('--smtp-host', required=True)
p.add_argument('--smtp-user', required=True)
p.add_argument('--smtp-from', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
for origin in [a.app_origin, a.identity_origin, a.admin_origin]:
    u = urlsplit(origin)
    if u.scheme != 'https' or not u.hostname or u.path or u.query or u.fragment or u.username or u.password:
        p.error('origins must be HTTPS origins without path or credentials')
if len({a.app_origin, a.identity_origin, a.admin_origin}) != 3:
    p.error('application, public identity and private administration origins must be distinct')
images = json.loads(Path(a.images).read_text())
import re
for name in ['web','worker','keycloak']:
    if not re.fullmatch(r'preview\.local/[a-z0-9-]+/[a-z0-9-]+@sha256:[0-9a-f]{64}', images.get(name,'')):
        p.error('real imported local image required: '+name)
recipe = yaml.safe_load(Path(a.base).read_text())
services = recipe['services']
for service in services.values(): service['enabled'] = False
services['web']['image'] = images['web']
services['worker']['image'] = images['worker']
services['worker']['env']['PUBLIC_ORIGIN'] = a.app_origin
web = services['web']
web['env'].update(PUBLIC_ORIGIN=a.app_origin, OIDC_PROVIDER='keycloak', OIDC_ISSUER=a.identity_origin+'/realms/tarjama', OIDC_CLIENT_ID='tarjama-web', OIDC_CLIENT_SECRET_FILE='/run/oidc/client_secret')
web['secrets'] = [dict(s, name='tarjama-keycloak-client') if s['path']=='/run/oidc' else s for s in web['secrets']]
web['egress'] = ['keycloak-https' if value=='oidc' else value for value in web.get('egress', [])]
recipe['jobs']['migrate']['image'] = images['web']
# Keep egress, shared provider secrets, media profiles and existing volumes intact.
pg_image = services['db']['image']
services['authdb'] = {
 'enabled':False, 'image':pg_image,'uid':70,'gid':70,'port':5432,
 'args':['postgres','-c','unix_socket_directories=/tmp','-c','max_connections=30','-c','shared_buffers=64MB'],
 'env':{'POSTGRES_DB':'postgres','POSTGRES_USER':'postgres','POSTGRES_PASSWORD_FILE':'/run/keycloak-db-admin/password','POSTGRES_INITDB_ARGS':'--auth-host=scram-sha-256 --auth-local=peer','PGDATA':'/data/pgdata','PGSERVICE':'keycloak-init','PGSERVICEFILE':'/configuration/pg_service.conf'},
 'secrets':[{'name':'tarjama-keycloak-db','path':'/run/keycloak-db'},{'name':'tarjama-keycloak-db-admin','path':'/run/keycloak-db-admin'}],
 'configs':[{'name':'keycloak-db-init','path':'/docker-entrypoint-initdb.d'},{'name':'keycloak-db-client','path':'/configuration'}],
 'volumes':[{'name':'identity-database','path':'/data'}],
 'resources':{'cpu':'500m','memory':'512Mi'},'tmp':'64Mi'
}
services['keycloak'] = {
 'enabled':False,'image':images['keycloak'],'uid':1000,'gid':1000,'port':8080,
 'env':{'KC_HOSTNAME':a.identity_origin,'KC_HOSTNAME_ADMIN':a.admin_origin,'KC_HTTP_ENABLED':'true','KC_HTTP_MANAGEMENT_HEALTH_ENABLED':'false','KC_PROXY_HEADERS':'xforwarded',
        'KC_DB_URL':'jdbc:postgresql://pv-authdb:5432/keycloak','KC_DB_USERNAME':'keycloak',
        'TARJAMA_PUBLIC_ORIGIN':a.app_origin,'TARJAMA_BACKCHANNEL_URL':'http://web:8080/auth/backchannel-logout',
        'TARJAMA_SMTP_HOST':a.smtp_host,'TARJAMA_SMTP_PORT':'587','TARJAMA_SMTP_USER':a.smtp_user,'TARJAMA_SMTP_FROM':a.smtp_from},
 'secrets':[{'name':'tarjama-keycloak-'+name,'path':'/run/keycloak-'+name} for name in ['db','client','mail','bootstrap']],
 'configs':[{'name':'keycloak-realm','path':'/configuration'}],
 'connect':['authdb','web'],'egress':['keycloak-smtp'],
 'resources':{'cpu':'1000m','memory':'1536Mi'},'tmp':'256Mi',
 'health':{'path':'/health/ready'}
}
recipe['volumes']['identity-database'] = {'size':'2Gi'}
recipe['volumes']['identity-backups'] = {'size':'1Gi'}
recipe.setdefault('configs',{})['keycloak-realm']={'tarjama-realm.json':(ROOT/'web/deploy/keycloak/tarjama-realm.json').read_text()}
recipe['configs']['keycloak-db-client']={'pg_service.conf':(ROOT/'web/deploy/keycloak/pg_service.conf').read_text()}
recipe['configs']['keycloak-db-init']={'10-keycloak.sh':(ROOT/'web/deploy/keycloak/init-db.sh').read_text()}
# The existing four-job limit is respected: augment the explicit backup job.
backup = recipe['jobs']['backup']
backup['secrets'].append({'name':'tarjama-keycloak-db','path':'/run/keycloak-db'})
backup['connect'].append('authdb')
backup['volumes'].append({'name':'identity-backups','path':'/identity-backups'})
backup['timeout'] = 480
recipe['configs']['deploy-backup']['identity-backup.sh']=(ROOT/'web/deploy/keycloak/backup.sh').read_text()
backup['args']=['-c','/bin/sh /configuration/backup.sh && /bin/sh /configuration/identity-backup.sh']
# Existing preview checks require Authelia and do not qualify a public target.
# Leave their definitions for history but do not present them as public checks.
Path(a.output).write_text('# STOPPED CANDIDATE. New secrets/network/storage/public routing required; see docs/KEYCLOAK_ADMIN_HANDOFF.md.\n'+yaml.safe_dump(recipe,sort_keys=False,allow_unicode=True))
print(a.output)
