import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, user = "alice") {
  await page.goto("/");
  await page.getByRole("button", { name: `Compte test ${user}` }).click();
  await expect(
    page.getByRole("heading", { name: "Mes projets" }),
  ).toBeVisible();
}
test("download shows durable stages and stops claiming activity when polling fails", async ({
  page,
}) => {
  await login(page);
  let progress = 0;
  let disconnected = false;
  await page.route("**/api/projects/fixture", async (route) => {
    if (disconnected) return route.abort();
    const response = await route.fetch();
    const data = await response.json();
    data.project.media = "";
    data.project.stage = "preparing";
    data.jobs = [
      {
        id: "progress-fixture",
        kind: "download",
        state: "running",
        progress,
        message: progress
          ? "Téléchargement de l’audio…"
          : "Téléchargement de la vidéo…",
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const job = page.locator(".job");
  await expect(job).toContainText("Téléchargement de la vidéo…");
  await expect(job).toContainText("0 sur 6 étapes terminées");
  await expect(job).not.toContainText("% des morceaux");
  await expect(job.locator(".activity-spinner")).toBeVisible();
  progress = 16;
  await expect(job).toContainText("1 sur 6 étapes terminées");
  await expect(job).toContainText("Téléchargement de l’audio…");
  await expect(job.getByRole("progressbar")).toHaveAttribute("value", "1");
  disconnected = true;
  await expect(page.getByRole("alert")).toContainText(
    "progression affichée n’est plus à jour",
  );
  await expect(job.locator(".activity-spinner")).toHaveCount(0);
  disconnected = false;
  await expect(job.locator(".activity-spinner")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/mobile-download-progress.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
test("follow stays enabled on manual scroll, is explicit, and seeks the same subtitle", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/projects/fixture", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.project.segments = Array.from({ length: 15 }, (_, i) => ({
      id: `scroll-${i}`,
      start_ms: i * 200,
      end_ms: (i + 1) * 200,
      arabic: "السلام عليكم",
      french: "Bonjour",
      version: 1,
    }));
    data.jobs = [
      {
        id: "waiting",
        kind: "cleanup",
        state: "waiting_provider",
        progress: 0,
        message: "Le service est temporairement limité ou indisponible.",
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.getByRole("button", { name: /Cours d’arabe/ }).click();
  const follow = page.getByRole("button", {
    name: "Suivi activé",
    exact: true,
  });
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".job")).toContainText(
    "Correction automatique de l’arabe",
  );
  await expect(page.locator(".job")).toContainText(
    "Cette étape doit se terminer",
  );
  await page.locator(".segments").dispatchEvent("wheel", { deltaY: 500 });
  await page.locator(".segments").dispatchEvent("touchmove");
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const slider = page.getByRole("slider", { name: "Position de lecture" });
  await slider.fill("2");
  await expect(page.locator("#segment-scroll-10")).toHaveClass(/active/);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // Seeking within the same active segment must reposition, too.
  await slider.fill("2.1");
  await expect
    .poll(() =>
      page.locator("#segment-scroll-10").evaluate((el) => {
        const player = document
          .querySelector(".player")!
          .getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return rect.top >= player.bottom && rect.top < window.innerHeight;
      }),
    )
    .toBeTruthy();
  await follow.click();
  await expect(
    page.getByRole("button", { name: "Suivi désactivé" }),
  ).toHaveAttribute("aria-pressed", "false");
});
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

test("step waits for compositionend when clicked while Arabic composition is active", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Vidéo importée/ }).click();
  const field = page.getByRole("textbox", { name: /Arabe/ });
  await field.focus();
  await field.dispatchEvent("compositionstart");
  await field.fill("كلمات أثناء الكتابة");
  let advanced = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/advance")) advanced = true;
  });
  await page
    .getByRole("button", { name: "Terminer la correction arabe · Traduire" })
    .evaluate((button: HTMLButtonElement) => button.click());
  await page.waitForTimeout(100);
  expect(advanced).toBe(false);
  await field.evaluate((el: HTMLTextAreaElement) => {
    el.value = "كلمات عربية مكتملة";
    el.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "مكتملة" }),
    );
  });
  await expect(page.getByRole("textbox", { name: /Français/ })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("textbox", { name: /Arabe/ })).toHaveValue(
    "كلمات عربية مكتملة",
  );
});

test("audio keeps playing while editing without stealing focus", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Vidéo importée/ }).click();
  const field = page.getByRole("textbox", { name: /Français/ });
  await expect(field).toBeVisible();
  await page.getByRole("button", { name: "Lecture", exact: true }).click();
  await field.focus();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0);
  await expect(field).toBeFocused();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});
