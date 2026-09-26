import { test, expect } from "@playwright/test";

for (const width of [393, 1440]) {
  test(`archive and restore preserve the project at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    const session = await (await page.request.get("/api/session")).json();
    const headers = {
      "X-CSRF-Token": session.csrf,
      Origin: "http://127.0.0.1:8090",
    };
    const response = await page.request.post("/api/projects", {
      headers,
      data: { title: `Archive ${width}`, url: "" },
    });
    expect(response.ok()).toBe(true);
    const p = await response.json();
    try {
      await page.reload();
      const card = page.getByRole("article", { name: p.title, exact: true });
      await card.getByRole("button", { name: "Archiver le projet" }).click();
      await expect(card).toHaveCount(0);
      await page.getByRole("button", { name: /^Archives/ }).click();
      await expect(page).toHaveURL(/\/projets\/archives$/);
      await expect(card).toBeVisible();
      await page.reload();
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: new RegExp(p.title) }).click();
      await expect(
        page.getByRole("region", { name: "Projet archivé" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Restaurer", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Projet archivé" }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "← Mes projets", exact: true })
        .click();
      await expect(card).toBeVisible();
      const after = (
        await (await page.request.get(`/api/projects/${p.id}`)).json()
      ).project;
      expect(after.version).toBe(p.version);
      expect(after.stage).toBe(p.stage);
      expect(Boolean(after.archived)).toBe(false);
      await page.screenshot({
        path: `test-results/archive-library-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await page.request.delete(`/api/projects/${p.id}`, { headers });
    }
  });

  test(`page jump buttons preserve follow and centered playback at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.route("**/api/projects/fixture", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.project.stage = "arabic";
      data.project.segments = Array.from({ length: 35 }, (_, n) => ({
        id: `scroll-${n}`,
        start_ms: n * 100,
        end_ms: (n + 1) * 100,
        arabic: "السلام عليكم",
        french: "",
        version: 1,
      }));
      await route.fulfill({ response, json: data });
    });
    await page.getByRole("button", { name: /Cours d’arabe/ }).click();
    const player = page.getByRole("region", { name: "Lecteur vidéo" });
    const play = page.getByRole("button", { name: "Lecture", exact: true });
    await expect(play).toBeVisible();
    await play.click();
    await page
      .getByRole("button", { name: "Aller en bas de la page", exact: true })
      .click();
    await expect(page.locator("video")).toHaveJSProperty("paused", true);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollHeight - innerHeight - scrollY,
        ),
      )
      .toBeLessThan(3);
    await page
      .getByRole("button", { name: "Aller en haut de la page", exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(
      page.getByRole("button", { name: /Suivi activé/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const box = await player.boundingBox(),
      control = await play.boundingBox();
    expect(
      Math.abs(control!.x + control!.width / 2 - box!.x - box!.width / 2),
    ).toBeLessThan(1);
    await player.screenshot({
      path: `test-results/page-controls-${width}.png`,
    });
  });
}

for (const mode of ["401", "redirect"]) {
  test(`expired session ${mode} stops polling and preserves unsaved text`, async ({
    page,
  }) => {
    await page.goto("/projets/fixture/corriger");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    const field = page.getByRole("textbox", { name: "Arabe one", exact: true });
    await field.fill("نص لم يحفظ بعد");
    let requests = 0;
    await page.route("**/api/projects/fixture", async (route) => {
      requests++;
      await route.fulfill(
        mode === "401"
          ? { status: 401, body: "Connexion requise" }
          : { status: 302, headers: { Location: "/auth/login" } },
      );
    });
    await expect(
      page.getByRole("link", { name: "Se connecter", exact: true }),
    ).toBeVisible({ timeout: 7000 });
    await expect(page.getByRole("alert")).toContainText("session a expiré");
    const count = requests;
    await page.waitForTimeout(4500); // Two polling periods must produce no further request.
    expect(requests).toBe(count);
    expect(
      await page.evaluate(() => Object.values(localStorage).join(" ")),
    ).toContain("نص لم يحفظ بعد");
    // Do not leave the deliberately dirty fixture draft to subsequent tests.
    await page.evaluate(() => localStorage.clear());
  });
}
