import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 393, height: 852 },
  { width: 412, height: 915 },
]) {
  test(`mobile subtitles stay readable and expand at ${viewport.width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
      recordVideo: {
        dir: "test-results/mobile-density-videos",
        size: viewport,
      },
    });
    const page = await context.newPage();
    const recording = page.video()!;
    await page.goto("/");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.route("**/api/projects/fixture", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        stage: "review",
        translation_source: 1,
        arabic_version: 1,
      });
      data.project.segments = Array.from({ length: 8 }, (_, n) => ({
        id: `density-${n}`,
        start_ms: n * 400,
        end_ms: (n + 1) * 400,
        arabic:
          n === 3
            ? "مرحبا بكم جميعا في هذا اللقاء. ".repeat(12)
            : "مرحبا بكم جميعا.",
        french:
          n === 3
            ? "Bienvenue à toutes et à tous dans cette rencontre. ".repeat(12)
            : "Bienvenue à toutes et à tous.",
        version: 1,
      }));
      await route.fulfill({ response, json: data });
    });
    await page.getByRole("button", { name: /Cours d’arabe/ }).click();
    const cards = page.locator(".segment");
    await expect(cards).toHaveCount(8);
    await page.evaluate(() => document.fonts.ready);
    await cards.first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    const player = page.getByRole("region", { name: "Lecteur vidéo" });
    await expect
      .poll(async () => {
        const boundary = (await player.boundingBox())!.y;
        return cards.evaluateAll(
          (els, bottom) =>
            els.filter((el) => {
              const r = el.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= bottom;
            }).length,
          boundary,
        );
      })
      .toBeGreaterThanOrEqual(2);
    await page.screenshot({
      path: `test-results/density-${viewport.width}.png`,
    });
    // Short reading pauses make the reusable UI recording reviewable.
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Options ·/ }).click();
    await page.getByRole("combobox", { name: "Vitesse" }).selectOption("1.25");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Options ·/ }).click();
    await cards.nth(3).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(2000);
    for (const lang of ["ar", "fr"]) {
      const field = cards.nth(3).locator(`textarea[lang="${lang}"]`);
      await expect
        .poll(() => field.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeLessThanOrEqual(1);
    }
    const french = cards.first().locator('textarea[lang="fr"]');
    const before = (await french.boundingBox())!.height;
    // Keep this edit focused: testing sizing must not save synthetic IDs to the fixture API.
    await french.fill(
      "Un sous-titre suffisamment long pour nécessiter plusieurs lignes. ".repeat(
        10,
      ),
    );
    await expect
      .poll(async () => (await french.boundingBox())!.height)
      .toBeGreaterThan(before * 2);
    expect(
      await french.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeLessThanOrEqual(1);
    await page.setViewportSize({
      width: viewport.height,
      height: viewport.width,
    });
    await page.setViewportSize(viewport);
    await expect
      .poll(() => french.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1);
    await context.close();
    await recording.saveAs(
      `test-results/mobile-density-${viewport.width}.webm`,
    );
  });
}
