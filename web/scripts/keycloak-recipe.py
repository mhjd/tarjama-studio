#!/usr/bin/env python3
"""Generate a stopped candidate; never edit/apply the live recipe or create secrets."""
import argparse
import ipaddress
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
import yaml

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--images', help='JSON with freshly imported, reviewed image references')
p.add_argument('--draft', action='store_true', help='non-deployable placeholders; no image build/import')
p.add_argument('--app-origin', required=True)
p.add_argument('--identity-base-url', required=True)
p.add_argument('--admin-base-url', required=True, help='private SSH/TLS endpoint, never a public route')
p.add_argument('--output', required=True)
a = p.parse_args()

def checked_url(value, path):
    try:
        u = urlsplit(value)
        port = u.port
        host = u.hostname or ''
        try:
            ipaddress.ip_address(host)
            valid_host = True
        except ValueError:
            valid_host = all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in host.split('.'))
        if (u.scheme != 'https' or not valid_host or not host or
            value != 'https://' + u.netloc + path or u.netloc != u.netloc.lower() or port == 443 or
            (port is not None and not 1 <= port <= 65535) or
            u.username is not None or u.password is not None or
            u.query or u.fragment or u.path != path or
            any(c.isspace() or ord(c) < 32 for c in value) or
            '%' in value or '\\' in value or '?' in value or '#' in value or
            u.netloc.endswith(':')):
            raise ValueError()
    except ValueError:
        p.error('expected a canonical HTTPS URL with path '+repr(path))
    return (u.scheme, host, port or 443)

app_origin = checked_url(a.app_origin, '')
identity_origin = checked_url(a.identity_base_url, '')
admin_origin = checked_url(a.admin_base_url, '')
if app_origin != identity_origin:
    p.error('the public identity URL must share the application origin')
if admin_origin == app_origin:
    p.error('administration requires a separate PRIVATE endpoint (for example an SSH tunnel)')
if a.draft:
    if a.images:
        p.error('--draft cannot assert image references')
    images = {name:'REQUIRED_'+name.upper()+'_IMAGE' for name in ['web','worker','keycloak']}
else:
    if not a.images:
        p.error('--images is required outside --draft')
    images = json.loads(Path(a.images).read_text())
    if images.get('status', '').startswith('superseded'):
        p.error('historical images cannot implement the single-domain contract; rebuild and reimport after coordination')
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
web['env'].update(PUBLIC_ORIGIN=a.app_origin, OIDC_PROVIDER='keycloak', OIDC_ISSUER=a.identity_base_url+'/realms/tarjama', OIDC_CLIENT_ID='tarjama-web', OIDC_CLIENT_SECRET_FILE='/run/oidc/client_secret')
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
 'env':{'KC_HOSTNAME':a.identity_base_url,'KC_HOSTNAME_ADMIN':a.admin_base_url,'KC_HTTP_RELATIVE_PATH':'/','KC_HTTP_ENABLED':'true','KC_HTTP_MANAGEMENT_HEALTH_ENABLED':'false','KC_PROXY_HEADERS':'xforwarded',
        'KC_DB_URL':'jdbc:postgresql://pv-authdb:5432/keycloak','KC_DB_USERNAME':'keycloak',
        'TARJAMA_PUBLIC_ORIGIN':a.app_origin,'TARJAMA_BACKCHANNEL_URL':'http://web:8080/auth/backchannel-logout'},
 'secrets':[{'name':'tarjama-keycloak-'+name,'path':'/run/keycloak-'+name} for name in ['db','client','bootstrap']],
 'configs':[{'name':'keycloak-realm','path':'/configuration'}],
 'connect':['authdb','web'],'egress':[],
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
Path(a.output).write_text(('# DRAFT: current image digests pending coordinated build/import. NOT DEPLOYABLE.\n' if a.draft else '')+'# STOPPED CANDIDATE. Check image provenance, private administration and public routing; see docs/KEYCLOAK_SINGLE_DOMAIN_20260927.md.\n'+yaml.safe_dump(recipe,sort_keys=False,allow_unicode=True))
print(a.output)
