// Disposable local Keycloak only. No production credentials or configurable URL.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const origin = 'http://localhost:8080';
const tokenResponse = await fetch(origin + '/realms/master/protocol/openid-connect/token', {
  method: 'POST', body: new URLSearchParams({grant_type:'password', client_id:'admin-cli',
    username:'bootstrap-tarjama', password:'synthetic-only'}), signal: AbortSignal.timeout(10000),
});
assert.equal(tokenResponse.status, 200);
const token = (await tokenResponse.json()).access_token;
const headers = {Authorization:`Bearer ${token}`, 'Content-Type':'application/json'};
async function request(path, options = {}) {
  return fetch(origin+'/admin/realms/tarjama'+path, {...options, headers, signal:AbortSignal.timeout(10000)});
}
// Existing names must survive the configuration change.
const created = await request('/users', {method:'POST', body:JSON.stringify({username:'legacy@example.test',
  email:'legacy@example.test', enabled:true, firstName:'Existing', lastName:'Account'})});
assert.equal(created.status, 201);
const userPath = new URL(created.headers.get('location')).pathname.split('/tarjama')[1];
const oldUser = await (await request(userPath)).json();
const response = await request('/users/profile');
assert.equal(response.status, 200);
const before = await response.json();
const after = JSON.parse(execFileSync('python3', ['/work/web/scripts/keycloak-user-profile.py'],
  {input:JSON.stringify(before), encoding:'utf8'}));
const updated = await request('/users/profile', {method:'PUT', body:JSON.stringify(after)});
assert.equal(updated.status, 200);
const actual = await (await request('/users/profile')).json();
for (const name of ['firstName','lastName']) {
  const attribute = actual.attributes.find(a => a.name === name);
  assert.deepEqual(attribute.permissions, {view:['admin'], edit:['admin']});
  assert.equal(attribute.required, undefined);
}
assert.deepEqual(await (await request(userPath)).json(), oldUser);
for (const [name, value] of [['before',before],['after',actual]]) {
  writeFileSync(`/work/web/.cache/keycloak-test/profile-${name}.json`, JSON.stringify(value,null,2)+'\n');
}
console.log('Native profile configuration: names omitted, existing user names preserved — PASS');
