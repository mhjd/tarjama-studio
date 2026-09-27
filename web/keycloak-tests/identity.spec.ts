import { test, expect, type Page } from "../frontend/node_modules/@playwright/test/index.js";

const origin = "http://localhost:8090";
const issuer = "http://localhost:8080/realms/tarjama";
const password = "Synthetic-Passphrase-123!";
async function emailLink(page: Page, email: string, after: number) {
  let link = "";
  await expect.poll(async () => {
    const messages = await (await page.request.get("http://localhost:8025")).json();
    for (const m of messages.slice(after).reverse()) {
      if (m.recipients.includes(email)) {
        const match = m.text.match(/http:\/\/localhost:8080\/realms\/tarjama\/login-actions\/action-token\?[^\s"<>]+/);
        if (match) { link = match[0].replaceAll("&amp;", "&"); return true; }
      }
    }
    return false;
  }, { timeout: 15000 }).toBeTruthy();
  return link;
}
async function login(page: Page, email: string, pass = password) {
  await page.goto(origin);
  await page.getByRole("link", { name: "Se connecter", exact: true }).click();
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(pass);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Mes projets" })).toBeVisible();
}
async function register(page: Page, email: string) {
  const count = (await (await page.request.get("http://localhost:8025")).json()).length;
  await page.goto(origin);
  await page.getByRole("link", { name: "Créer mon compte" }).click();
  await page.locator("#email").fill(email);
  for (const id of ["firstName", "lastName"]) {
    if (await page.locator(`#${id}`).count()) await page.locator(`#${id}`).fill("Test");
  }
  await page.locator('input[type="submit"],button[type="submit"]').click();
  // No application session before the user proves ownership of the email.
  expect((await page.request.get(`${origin}/api/session`)).status()).toBe(401);
  await page.goto(await emailLink(page, email, count));
  // Keycloak 26.7 sets the password only AFTER email ownership is proved.
  await page.locator("#password-new").fill(password);
  await page.locator("#password-confirm").fill(password);
  await page.locator('input[type="submit"],button[type="submit"]').click();
  if (!page.url().startsWith(origin)) {
    const back = page.locator('a[href^="http://localhost:8090"]');
    if (await back.count()) await back.first().click();
  }
  await expect(page.getByRole("heading", { name: "Mes projets" })).toBeVisible();
}

test("real Keycloak registration, verified email, private accounts, recovery, logout and revocation", async ({ browser }) => {
  test.setTimeout(180000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  try {
    const health = await alice.request.get("http://localhost:8080/health/ready");
    expect(health.status()).toBe(200);
    expect((await health.json()).status).toBe("UP");
    await register(alice, "alice@example.test");
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
    await expect(alice).toHaveURL(/protocol\/openid-connect\/logout/);
    // Without storing an ID token, Keycloak confirms the SSO logout.
    await alice.locator('input[type="submit"],button[type="submit"]').click();
    await expect(alice.getByRole("link", {name: "Se connecter", exact: true})).toBeVisible();
    expect((await alice.request.get(`${origin}/api/session`)).status()).toBe(401);
    await login(alice, "alice@example.test");
    expect((await (await alice.request.get(`${origin}/api/session`)).json()).id).toBe(session.id);

    // Admin credentials exist only in this disposable qualification network.
    // The application never receives a Keycloak admin token.
    const adminResponse = await alice.request.post("http://localhost:8080/realms/master/protocol/openid-connect/token", {form: {grant_type: "password", client_id: "admin-cli", username: "bootstrap-tarjama", password: "synthetic-only"}});
    expect(adminResponse.ok()).toBeTruthy();
    const admin = (await adminResponse.json()).access_token;
    const headers = {Authorization: `Bearer ${admin}`};
    const users = await (await alice.request.get("http://localhost:8080/admin/realms/tarjama/users?email=alice%40example.test&exact=true", {headers})).json();
    expect(users).toHaveLength(1);
    const revoke = await alice.request.post(`http://localhost:8080/admin/realms/tarjama/users/${users[0].id}/logout`, {headers});
    expect(revoke.status()).toBe(204);
    await expect.poll(async () => (await alice.request.get(`${origin}/api/session`)).status()).toBe(401);
    expect((await bob.request.get(`${origin}/api/session`)).status()).toBe(200);

    // Real recovery email and password change through the hosted login page.
    await aliceContext.clearCookies();
    const count = (await (await alice.request.get("http://localhost:8025")).json()).length;
    await alice.goto(`${origin}/auth/login`);
    await alice.locator('a[href*="reset-credentials"]').click();
    await alice.locator("#username").fill("alice@example.test");
    await alice.locator('input[type="submit"],button[type="submit"]').click();
    await alice.goto(await emailLink(alice, "alice@example.test", count));
    await alice.locator("#password-new").fill("Changed-Synthetic-Passphrase-123!");
    await alice.locator("#password-confirm").fill("Changed-Synthetic-Passphrase-123!");
    await alice.locator('input[type="submit"],button[type="submit"]').click();
    await aliceContext.clearCookies();
    await login(alice, "alice@example.test", "Changed-Synthetic-Passphrase-123!");
    expect((await (await alice.request.get(`${origin}/api/session`)).json()).id).toBe(session.id);
    await alice.screenshot({path: "/work/web/.cache/keycloak-test/account-ready.png"});
  } finally {
    await aliceContext.close(); await bobContext.close();
  }
});
