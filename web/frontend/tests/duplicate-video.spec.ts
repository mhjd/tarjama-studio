import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`duplicate link opens the existing project without starting work (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/projets/nouveau");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    let creates = 0;
    let advances = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/advance") || r.url().endsWith("/exports"))
        advances++;
    });
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      creates++;
      await route.fulfill({
        status: 409,
        json: {
          code: "duplicate_video",
          message: "Cette vidéo est déjà présente dans vos projets.",
          project_id: "fixture",
        },
      });
    });
    await page
      .getByLabel("Lien YouTube")
      .fill("https://youtu.be/b1MKJ5gHig0?t=20");
    await page.getByRole("button", { name: "Commencer", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Cette vidéo est déjà présente dans vos projets.",
    );
    const open = page.getByRole("button", {
      name: "Ouvrir le projet existant",
    });
    await expect(open).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Commencer", exact: true }),
    ).toHaveCount(0);
    // The fallback state must not stick to a different URL or file import.
    await page.getByLabel("Lien YouTube").fill("https://youtu.be/YuV8IY-Bgoc");
    await expect(open).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Commencer", exact: true }).click();
    await expect(open).toBeVisible();
    await page
      .getByRole("button", { name: "Importer une vidéo", exact: true })
      .click();
    await expect(open).toHaveCount(0);
    await expect(page.getByLabel("Vidéo de votre appareil")).toBeVisible();
    await page
      .getByRole("button", { name: "Coller un lien", exact: true })
      .click();
    await page.getByRole("button", { name: "Commencer", exact: true }).click();
    await open.click();
    await expect(page).toHaveURL(/\/projets\/fixture\/corriger$/);
    await expect(
      page.getByRole("textbox", { name: "Arabe one", exact: true }),
    ).toBeEditable();
    expect(creates).toBe(3);
    expect(advances).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
