import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, user = "alice") {
  await page.goto("/");
  await page.getByRole("button", { name: `Compte test ${user}` }).click();
  await expect(
    page.getByRole("heading", { name: "Mes projets" }),
  ).toBeVisible();
}
test("private projects, unchanged blur, offline draft, IME flush, review and real export", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const arabic = page.getByRole("textbox", { name: "Arabe one", exact: true });
  await expect(arabic).toHaveValue("السلام عليكم");
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/segments/")) writes++;
  });
  await arabic.focus();
  await page.getByRole("heading", { name: "Correction arabe" }).click();
  await page.waitForTimeout(250);
  expect(writes).toBe(0);
  // Network failure preserves text; retry must not claim a successful save.
  await page.route("**/segments/one", (route) => route.abort());
  await arabic.fill("السلام عليكم جميعا");
  await arabic.blur();
  await expect(page.getByRole("status")).toContainText("Échec");
  await expect(arabic).toHaveValue("السلام عليكم جميعا");
  await page.unroute("**/segments/one");
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  await page.reload();
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Arabe one", exact: true }),
  ).toHaveValue("السلام عليكم جميعا");
  // A second account cannot enumerate the project or fetch its media.
  const context = await browser.newContext();
  const other = await context.newPage();
  await login(other, "bob");
  await expect(
    other.getByRole("button", { name: /Cours d’arabe/ }),
  ).toHaveCount(0);
  const response = await other.request.get("/api/projects/fixture/media");
  expect(response.status()).toBe(404);
  await context.close();
  const text = page.getByRole("textbox", { name: "Arabe one", exact: true });
  await text.focus();
  await text.dispatchEvent("compositionstart");
  await text.fill("السلام عليكم ورحمة الله");
  await text.dispatchEvent("compositionend", { data: "الله" });
  await page
    .getByRole("button", { name: "Terminer la correction arabe · Traduire" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Français one", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("textbox", { name: "Arabe one", exact: true }),
  ).toHaveValue("السلام عليكم ورحمة الله");
  await page
    .getByRole("textbox", { name: "Français one", exact: true })
    .fill("Bonjour à toutes et à tous.");
  await page
    .getByRole("button", { name: "Terminer la relecture", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Votre vidéo sous-titrée" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Créer la vidéo" }).click();
  await expect(
    page.getByRole("link", { name: /Télécharger · Low/ }),
  ).toBeVisible({ timeout: 30000 });
  const link = page.getByRole("link", { name: /Télécharger · Low/ });
  const download = await page.request.get((await link.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("video/mp4");
  expect((await download.body()).length).toBeGreaterThan(1000);
  await page.screenshot({
    path: "test-results/mobile-review.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
test("two tabs conflict keeps the second draft and blocks advancing", async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const second = await context.newPage();
  await second.goto("/");
  await second.getByRole("button", { name: /Cours d’arabe/ }).click();
  const a = page.getByRole("textbox", { name: "Arabe one", exact: true }),
    b = second.getByRole("textbox", { name: "Arabe one", exact: true });
  await b.fill("مسودة النافذة الثانية");
  await a.fill("تعديل النافذة الأولى");
  await a.blur();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  await b.blur();
  await expect(second.getByRole("status")).toContainText("Échec");
  await expect(b).toHaveValue("مسودة النافذة الثانية");
  await second.close();
});
test("file import is a first class creation path and real media converges to Arabic review", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "+ Nouvelle vidéo" }).click();
  await page
    .getByRole("button", { name: "Importer une vidéo", exact: true })
    .click();
  await page.getByLabel("Titre", { exact: true }).fill("Vidéo importée");
  await page
    .getByLabel("Vidéo de votre appareil")
    .setInputFiles("/tmp/tarjama-storage/fixture.mp4");
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(
    page.getByRole("heading", { name: "Correction arabe" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("textbox", { name: /Arabe/ })).toHaveValue(
    "السلام عليكم",
  );
  await expect(page.getByRole("textbox", { name: /Français/ })).toHaveCount(0);
});

test("blur saves only that field and never overwrites characters typed during a slow response", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const a = page.getByRole("textbox", { name: "Arabe one", exact: true }),
    b = page.getByRole("textbox", { name: "Arabe two", exact: true });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/segments/one", async (route) => {
    const result = await route.fetch();
    await held;
    await route.fulfill({ response: result });
  });
  let secondWrites = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().endsWith("/segments/two"))
      secondWrites++;
  });
  await a.fill("نص محفوظ عند الخروج");
  await b.focus();
  await b.fill("ما زلت أكتب هنا");
  release();
  await page.waitForTimeout(500);
  expect(secondWrites).toBe(0);
  await expect(b).toHaveValue("ما زلت أكتب هنا");
  await b.blur();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  expect(secondWrites).toBe(1);
});
