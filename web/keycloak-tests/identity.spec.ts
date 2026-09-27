import { test, expect, type Page } from "../frontend/node_modules/@playwright/test/index.js";

const origin = "http://localhost:8091";
const issuer = origin + "/realms/tarjama";
const privateIdentity = "http://localhost:8080";
const password = "Synthetic-Passphrase-123!";
async function login(page: Page, email: string, pass = password) {
  await page.goto(origin);
  await expect(page.getByRole("link", { name: "Se connecter", exact: true })).toHaveAttribute("href", "/sign-in");
  await page.getByRole("link", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(origin + "/realms/tarjama/"));
  await expect(page.locator('a[href*="reset-credentials"]')).toHaveCount(0);
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(pass);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Mes projets" })).toBeVisible();
}
async function register(page: Page, email: string) {
  await page.goto(origin);
  await expect(page.getByText("Pas de validation ni de récupération par email.", {exact:false})).toBeVisible();
  await expect(page.getByRole("link", { name: "Créer mon compte" })).toHaveAttribute("href", "/sign-up");
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(new RegExp(origin + "/realms/tarjama/"));
  await page.locator("#email").fill(email);
  for (const id of ["firstName", "lastName"]) {
    if (await page.locator(`#${id}`).count()) await page.locator(`#${id}`).fill("Test");
  }
  await page.locator("#password").fill(password);
  await page.locator("#password-confirm").fill(password);
  expect((await page.request.get(`${origin}/api/session`)).status()).toBe(401);
  await page.locator('input[type="submit"],button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: "Mes projets" })).toBeVisible();
}

test("one-origin Keycloak with sign-in/sign-up entrypoints, no email workflow, private accounts and revocation", async ({ browser }) => {
  test.setTimeout(180000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const assets: {url:string; status:number}[] = [];
  alice.on('response', r => { if (r.url().includes('/resources/')) assets.push({url:r.url(),status:r.status()}); });
  try {
    const health = await alice.request.get(`${privateIdentity}/health/ready`);
    expect(health.status()).toBe(200);
    expect((await health.json()).status).toBe("UP");
    const discovery = await (await alice.request.get(`${issuer}/.well-known/openid-configuration`)).json();
    expect(discovery.issuer).toBe(issuer);
    for (const key of ['authorization_endpoint','token_endpoint','jwks_uri','end_session_endpoint']) {
      expect(discovery[key]).toMatch(new RegExp('^'+issuer+'/protocol/openid-connect/'));
    }
    // This is the reference proxy's filtering, not proof of the VPS proxy rules.
    for (const path of ['/identity/', '/admin/', '/realms/master/', '/health/ready', '/metrics', '/realms/tarjama/account/']) {
      expect((await alice.request.get(origin+path)).status()).toBe(404);
    }
    expect((await alice.request.get(origin+'/auth/callback')).status()).toBe(400);
    expect((await alice.request.post(origin+'/auth/backchannel-logout', {form:{logout_token:'unsigned'}})).status()).toBe(400);
    await register(alice, "alice@example.test");
    const cookies = await aliceContext.cookies();
    const identityCookies = cookies.filter(c => c.name.startsWith('KEYCLOAK') || c.name.startsWith('AUTH_SESSION'));
    expect(identityCookies.length).toBeGreaterThan(0);
    expect(identityCookies.every(c => c.path.startsWith('/realms/tarjama/'))).toBeTruthy();
    expect(cookies.find(c => c.name==='tarjama_session')?.path).toBe('/');
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every(a => a.url.startsWith(origin+'/resources/') && a.status===200)).toBeTruthy();

    const session = await (await alice.request.get(`${origin}/api/session`)).json();
    const create = await alice.request.post(`${origin}/api/projects`, { headers: {Origin: origin, "X-CSRF-Token": session.csrf}, data: {title: "Projet privé Alice", url: ""} });
    expect(create.status()).toBe(200);
    const project = await create.json();
    await register(bob, "bob@example.test");
    const bobSession = await (await bob.request.get(`${origin}/api/session`)).json();
    expect(bobSession.id).not.toBe(session.id);
    expect(await (await bob.request.get(`${origin}/api/projects`)).json()).toEqual([]);
    expect((await bob.request.get(`${origin}/api/projects/${project.id}`)).status()).toBe(404);
    expect((await bob.request.delete(`${origin}/api/projects/${project.id}`, {headers: {Origin: origin, "X-CSRF-Token": bobSession.csrf}})).status()).toBe(404);

    await alice.goto(origin);
    await alice.getByRole("button", {name: "Déconnexion"}).click();
    await expect(alice).toHaveURL(new RegExp(issuer+'/protocol/openid-connect/logout'));
    await alice.locator('input[type="submit"],button[type="submit"]').click();
    await expect(alice.getByRole("link", {name: "Se connecter", exact: true})).toBeVisible();
    expect((await alice.request.get(`${origin}/api/session`)).status()).toBe(401);
    await login(alice, "alice@example.test");
    expect((await (await alice.request.get(`${origin}/api/session`)).json()).id).toBe(session.id);

    // Synthetic admin calls use only the private test endpoint, never the public router.
    const adminResponse = await alice.request.post(`${privateIdentity}/realms/master/protocol/openid-connect/token`, {form: {grant_type: "password", client_id: "admin-cli", username: "bootstrap-tarjama", password: "synthetic-only"}});
    expect(adminResponse.ok()).toBeTruthy();
    const admin = (await adminResponse.json()).access_token;
    const headers = {Authorization: `Bearer ${admin}`};
    const realm = await (await alice.request.get(`${privateIdentity}/admin/realms/tarjama`, {headers})).json();
    expect(realm.verifyEmail).toBe(false);
    expect(realm.resetPasswordAllowed).toBe(false);
    expect(Object.keys(realm.smtpServer || {})).toHaveLength(0);
    const users = await (await alice.request.get(`${privateIdentity}/admin/realms/tarjama/users?email=alice%40example.test&exact=true`, {headers})).json();
    expect(users).toHaveLength(1);
    expect(users[0].emailVerified).toBe(false);
    expect(users[0].requiredActions).not.toContain('VERIFY_EMAIL');
    const actions = await (await alice.request.get(`${privateIdentity}/admin/realms/tarjama/authentication/required-actions`, {headers})).json();
    for (const name of ['UPDATE_PROFILE','VERIFY_PROFILE','VERIFY_EMAIL','UPDATE_EMAIL']) {
      expect(actions.some((a: any) => a.alias===name && a.enabled)).toBe(false);
    }
    // Public application-initiated actions must not allow changing an email.
    for (const action of ['UPDATE_PROFILE','VERIFY_PROFILE','UPDATE_EMAIL']) {
      const start = await alice.request.get(origin+'/sign-in', {maxRedirects:0});
      const actionURL = new URL(start.headers().location);
      actionURL.searchParams.set('kc_action', action);
      await alice.goto(actionURL.href);
      await expect(alice.locator('input[name="email"]')).toHaveCount(0);
      expect(alice.url()).not.toContain('/login-actions/required-action');
    }
    const userURL = `${privateIdentity}/admin/realms/tarjama/users/${users[0].id}`;
    expect((await alice.request.post(userURL+'/logout', {headers})).status()).toBe(204);
    await expect.poll(async () => (await alice.request.get(`${origin}/api/session`)).status()).toBe(401);
    expect((await bob.request.get(`${origin}/api/session`)).status()).toBe(200);

    // Operator-assisted recovery: independent identity proof is an operational
    // prerequisite, not an email-ownership claim made by this synthetic test.
    expect((await alice.request.put(userURL+'/reset-password', {headers, data:{type:'password', value:'Changed-Synthetic-Passphrase-123!', temporary:false}})).status()).toBe(204);
    await aliceContext.clearCookies();
    await login(alice, "alice@example.test", "Changed-Synthetic-Passphrase-123!");
    expect((await (await alice.request.get(`${origin}/api/session`)).json()).id).toBe(session.id);
    await alice.screenshot({path: "/work/web/.cache/keycloak-test/account-ready.png"});
  } finally {
    await aliceContext.close(); await bobContext.close();
  }
});
