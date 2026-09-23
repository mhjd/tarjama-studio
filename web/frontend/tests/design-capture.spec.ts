import { test, expect } from "@playwright/test";
const sizes = [
  { name: "iphone15", width: 393, height: 852 },
  { name: "pixel6", width: 412, height: 915 },
  { name: "macbook15", width: 1440, height: 932 },
];
for (const size of sizes)
  test(`design capture ${size.name}`, async ({ browser }) => {
    const dir = `test-results/design-${size.name}`;
    const context = await browser.newContext({
      viewport: size,
      recordVideo: { dir, size: { width: size.width, height: size.height } },
    });
    const page = await context.newPage();
    let stage = "arabic";
    await page.route("**/api/projects/fixture", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const r = await route.fetch();
      const x = await r.json();
      x.project.title =
        "France 24 · Une longue édition internationale à relire et traduire";
      x.project.stage = stage;
      x.project.url = "https://www.youtube.com/watch?v=b1MKJ5gHig0";
      x.project.segments = Array.from({ length: 8 }, (_, i) => ({
        id: `visual-${i}`,
        start_ms: i * 400,
        end_ms: (i + 1) * 400,
        arabic: "السلام عليكم ورحمة الله، مرحبًا بكم في هذا اللقاء.",
        french: "Bonjour à toutes et à tous, bienvenue dans cette édition.",
        version: 1,
      }));
      x.jobs = [];
      await route.fulfill({ response: r, json: x });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.getByRole("button", { name: /Cours d’arabe/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Arabe visual-0", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Aller à la validation" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(
      await page
        .getByRole("textbox", { name: "Titre du projet" })
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    ).toBeTruthy();
    expect(await page.locator(".player .follow-toggle").count()).toBe(0);
    for (const item of await page.locator(".steps li").all()) {
      expect(
        await item.evaluate((el) => {
          const a = el.getBoundingClientRect(),
            b = el.querySelector("span")!.getBoundingClientRect();
          return Math.abs((a.left + a.right - b.left - b.right) / 2) < 2;
        }),
      ).toBeTruthy();
    }
    if (size.width < 640) {
      const dock = await page.locator(".player").boundingBox();
      expect(dock!.y).toBeGreaterThan(size.height - 180);
    }
    await page.screenshot({ path: `${dir}/01-correction.png` });
    let advances = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/advance")) advances++;
    });
    const validate = page.getByRole("button", {
      name: "Valider et traduire",
      exact: true,
    });
    await expect(validate).toHaveCount(1);
    await page.getByRole("link", { name: "Aller à la validation" }).click();
    await expect(page.locator("#validation")).toBeFocused();
    await expect(validate).toBeInViewport();
    const buttonBox = await validate.boundingBox();
    const dockBox = await page.locator(".player").boundingBox();
    if (size.width < 640)
      expect(buttonBox!.y + buttonBox!.height).toBeLessThan(dockBox!.y);
    else expect(buttonBox!.y).toBeGreaterThan(dockBox!.y + dockBox!.height);
    expect(advances).toBe(0);
    await page.screenshot({ path: `${dir}/07-validation-shortcut.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Agrandir la vidéo" }).click();
    await expect(
      page.getByRole("button", { name: "Réduire la vidéo" }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: `${dir}/05-player-expanded.png` });
    await page.getByRole("button", { name: "Réduire la vidéo" }).click();
    stage = "review";
    await expect(
      page.getByRole("textbox", { name: "Français visual-0", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Valider et exporter" }),
    ).toHaveCount(1);
    const arabicBox = await page
      .getByRole("textbox", { name: "Arabe visual-0", exact: true })
      .boundingBox();
    const frenchBox = await page
      .getByRole("textbox", { name: "Français visual-0", exact: true })
      .boundingBox();
    expect(frenchBox!.y).toBeGreaterThanOrEqual(
      arabicBox!.y + arabicBox!.height,
    );
    if (size.width > 640) {
      const player = await page.locator(".player").boundingBox();
      const play = await page
        .getByRole("button", { name: "Lecture", exact: true })
        .boundingBox();
      expect(play!.width).toBeGreaterThanOrEqual(76);
      expect(
        Math.abs(play!.x + play!.width / 2 - player!.x - player!.width / 2),
      ).toBeLessThan(2);
    }
    await page.screenshot({ path: `${dir}/02-traduction.png` });
    await page
      .getByRole("textbox", { name: "Français visual-5", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/03-relecture.png` });
    await page
      .locator('.next-step[data-position="bottom"]')
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/06-next-step-bottom.png` });
    stage = "ready";
    await expect(
      page.getByRole("heading", { name: "Votre vidéo sous-titrée" }),
    ).toBeVisible();
    await page.locator(".export-panel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/04-export.png` });
    if (size.width < 640) {
      const create = await page
        .getByRole("button", { name: "Créer la vidéo" })
        .boundingBox();
      const player = await page.locator(".player").boundingBox();
      expect(create!.y + create!.height).toBeLessThan(player!.y);
    }
    await expect(
      page.getByRole("combobox", { name: "Sous-titres" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Sous-titres français", { exact: true }),
    ).toBeVisible();
    await context.close();
  });
