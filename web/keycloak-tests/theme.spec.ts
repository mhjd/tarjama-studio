import { test, expect, type Page } from '../frontend/node_modules/@playwright/test/index.js';
import { createHmac } from 'node:crypto';

const origin = 'http://localhost:8091';
const adminOrigin = 'http://localhost:8080';
const password = 'Synthetic-Theme-Passphrase-123!';
const devices = [
  { name: 'macbook-air-15', width: 1440, height: 932 },
  { name: 'iphone-15', width: 393, height: 852 },
  { name: 'pixel-6', width: 412, height: 915 },
];
async function capture(page: Page, name: string) {
  await expect(page.locator('link[href*="/tarjama-v1/css/tarjama.css"]')).toHaveCount(1);
  await expect(page.locator('#kc-header-wrapper')).toContainText('Tarjama');
  expect((await page.locator('#kc-page-title').boundingBox())!.width).toBeGreaterThan(250);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 23, 25)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const input of await page.locator('input:not([type=hidden]), button, select').all()) {
    if (await input.isVisible()) expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `/work/web/.cache/keycloak-test/preview/${name}.png`, fullPage: true });
}
async function submit(page: Page) {
  await page.locator('input[type=submit],button[type=submit]').click();
}
async function adminHeaders(page: Page) {
  const response = await page.request.post(adminOrigin + '/realms/master/protocol/openid-connect/token', {
    form: {grant_type:'password', client_id:'admin-cli', username:'bootstrap-tarjama', password:'synthetic-only'},
  });
  expect(response.ok()).toBe(true);
  return { Authorization: `Bearer ${(await response.json()).access_token}` };
}
function totp(secret: string) {
  const bits = [...secret.replace(/\s/g, '').toUpperCase()].map(c => {
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
    if (index < 0) throw Error('Invalid synthetic OTP seed');
    return index.toString(2).padStart(5, '0');
  }).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

for (const device of devices) {
  test(`theme: registration, errors, login and logout — ${device.name}`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, viewport: device, locale: 'fr-FR', colorScheme: 'light' });
    const page = await context.newPage();
    const badAssets: string[] = [];
    const passwordDestinations: string[] = [];
    page.on('response', r => {
      if (r.url().includes('/resources/') && r.status() >= 400) badAssets.push(new URL(r.url()).pathname);
    });
    page.on('request', r => {
      if (r.method() === 'POST' && (r.postData() || '').includes('password=')) passwordDestinations.push(new URL(r.url()).pathname);
    });
    try {
      await page.goto('/sign-in');
      await expect(page.locator('#username')).toBeVisible();
      await capture(page, `${device.name}-01-login`);
      if (device.name === 'macbook-air-15') {
        await page.locator('#login-select-toggle').selectOption((await page.locator('option[value*="kc_locale=en"]').getAttribute('value'))!);
        await expect(page.getByRole('button', {name:'Sign in', exact:true})).toBeVisible();
        await capture(page, 'macbook-air-15-07-english');
        await page.locator('#login-select-toggle').selectOption((await page.locator('option[value*="kc_locale=fr"]').getAttribute('value'))!);
      }
      await page.locator('#username').focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('#password')).toBeFocused();
      await page.goto('/sign-up');
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.getByText('Conservez votre mot de passe', {exact:false})).toBeVisible();
      await capture(page, `${device.name}-02-register`);
      const email = `theme-${device.name}@example.test`;
      await page.locator('#email').fill(email);
      await expect(page.locator('#firstName, #lastName')).toHaveCount(0);
      await page.locator('#password').fill('short');
      await page.locator('#password-confirm').fill('different');
      await submit(page);
      await expect(page.locator('.kc-feedback-text').first()).toBeVisible();
      await page.locator('#password').fill('');
      await page.locator('#password-confirm').fill('');
      await capture(page, `${device.name}-03-register-error`);
      await page.locator('#password').fill(password);
      await page.locator('#password-confirm').fill(password);
      const visibility = page.locator('button[data-password-toggle]').first();
      await expect(visibility).toBeVisible();
      await visibility.click();
      await expect(page.locator('#password')).toHaveAttribute('type', 'text');
      await visibility.click();
      await expect(page.locator('#password')).toHaveAttribute('type', 'password');
      await submit(page);
      await expect(page.getByRole('heading', { name: 'Mes projets' })).toBeVisible();
      await page.getByRole('button', {name:'Déconnexion'}).click();
      await expect(page).toHaveURL(/protocol\/openid-connect\/logout/);
      await capture(page, `${device.name}-04-logout`);
      await submit(page);
      await expect(page.getByRole('link', {name:'Se connecter', exact:true})).toBeVisible();
      expect((await page.request.get('/api/session')).status()).toBe(401);
      await page.goto('/sign-in');
      await page.locator('#username').fill(email);
      await page.locator('#password').fill('Wrong-Synthetic-Password!');
      await submit(page);
      await expect(page.locator('.kc-feedback-text').first()).toBeVisible();
      await page.locator('#password').fill('');
      await capture(page, `${device.name}-05-login-error`);
      await page.locator('#password').fill(password);
      await submit(page);
      await expect(page.getByRole('heading', {name:'Mes projets'})).toBeVisible();
      expect(passwordDestinations.length).toBeGreaterThan(3);
      expect(passwordDestinations.every(p => p.startsWith('/realms/tarjama/login-actions/'))).toBe(true);
      expect(badAssets).toEqual([]);

      if (device.name === 'macbook-air-15') {
        const headers = await adminHeaders(page);
        const realm = await (await page.request.get(adminOrigin+'/admin/realms/tarjama', {headers})).json();
        expect(realm.loginTheme).toBe('tarjama-v1');
        expect(realm.adminTheme || '').not.toBe('tarjama-v1');
        const master = await (await page.request.get(adminOrigin+'/admin/realms/master', {headers})).json();
        expect(master.loginTheme || '').not.toBe('tarjama-v1');
        expect(master.adminTheme || '').not.toBe('tarjama-v1');
        const users = await (await page.request.get(adminOrigin+'/admin/realms/tarjama/users?email='+encodeURIComponent(email)+'&exact=true', {headers})).json();
        const userURL = adminOrigin+'/admin/realms/tarjama/users/'+users[0].id;
        expect((await page.request.put(userURL, {headers, data:{requiredActions:['CONFIGURE_TOTP']}})).status()).toBe(204);
        await page.request.post(userURL+'/logout', {headers});
        await context.clearCookies();
        await page.goto('/sign-in');
        await page.locator('#username').fill(email);
        await page.locator('#password').fill(password);
        await submit(page);
        await expect(page.locator('#mode-manual')).toBeVisible();
        await page.locator('#mode-manual').click();
        const seed = (await page.locator('#kc-totp-secret-key').textContent())!;
        const enrolledPeriod = Math.floor(Date.now() / 30000);
        await page.locator('#totp').fill(totp(seed));
        await page.locator('#userLabel').fill('Synthetic test device');
        await submit(page);
        await expect(page.getByRole('heading', {name:'Mes projets'})).toBeVisible();
        await page.request.post(userURL+'/logout', {headers});
        await context.clearCookies();
        await page.goto('/sign-in');
        await page.locator('#username').fill(email);
        await page.locator('#password').fill(password);
        await submit(page);
        await expect(page.locator('#otp')).toBeVisible();
        await capture(page, 'macbook-air-15-06-mfa');
        await page.locator('#otp').fill('invalid');
        await submit(page);
        await expect(page.locator('.kc-feedback-text').first()).toBeVisible();
        // Keycloak rejects replay of the code consumed during enrollment.
        await expect.poll(() => Math.floor(Date.now() / 30000), {timeout:35000, intervals:[500]})
          .toBeGreaterThan(enrolledPeriod);
        await page.locator('#otp').fill(totp(seed));
        await submit(page);
        await expect(page.getByRole('heading', {name:'Mes projets'})).toBeVisible();
      }
    } finally { await context.close(); }
  });
}
