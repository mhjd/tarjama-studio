import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const viewport of [
  { width: 1440, height: 932 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
]) {
  test(`export page offers video and SRT without review fields at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    let mutations = 0,
      mediaRequests = 0;
    page.on("request", (r) => {
      if (r.method() !== "GET") mutations++;
      if (new URL(r.url()).pathname === "/api/projects/fixture/media")
        mediaRequests++;
    });
    await page.route("**/api/projects/fixture", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        stage: "ready",
        translation_source: data.project.arabic_version,
      });
      data.project.segments.forEach((s: { french: string }) => {
        s.french = "Traduction relue et conservée.";
      });
      data.jobs = [];
      await route.fulfill({ response, json: data });
    });
    const content =
      "1\n00:00:00,000 --> 00:00:02,000\nTraduction relue et conservée.\n";
    await page.route(
      "**/api/projects/fixture/subtitles/fr.srt?version=*",
      async (route) => {
        await route.fulfill({
          body: content,
          contentType: "application/x-subrip; charset=utf-8",
          headers: {
            "Content-Disposition": 'attachment; filename="fixture_fr.srt"',
          },
        });
      },
    );
    await page.goto("/projets/fixture/exporter");
    const video = page.getByRole("region", {
      name: "Votre vidéo sous-titrée",
      exact: true,
    });
    const subtitles = page.getByRole("region", {
      name: "Exporter les sous-titres",
      exact: true,
    });
    await expect(video).toBeVisible();
    await expect(subtitles).toBeVisible();
    await expect(page.locator(".segments, video, .follow-toggle")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("textbox", { name: /^(Arabe|Français) / }),
    ).toHaveCount(0);
    await expect(subtitles.locator("xpath=ancestor::details")).toHaveCount(0);
    const french = subtitles.getByRole("button", {
      name: "Télécharger le français · SRT",
      exact: true,
    });
    await expect(french).toBeVisible();
    await expect(french).toBeEnabled();
    await expect(
      subtitles.getByRole("button", {
        name: "Télécharger l’arabe · SRT",
        exact: true,
      }),
    ).toHaveCount(0);
    const v = (await video.boundingBox())!,
      s = (await subtitles.boundingBox())!;
    if (viewport.width > 800) expect(Math.abs(v.y - s.y)).toBeLessThan(2);
    else expect(s.y).toBeGreaterThanOrEqual(v.y + v.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: testInfo.outputPath(`exports-${viewport.width}.png`),
      fullPage: true,
    });
    const downloading = page.waitForEvent("download");
    await french.click();
    const file = await downloading;
    expect(file.suggestedFilename()).toBe("fixture_fr.srt");
    expect(await readFile((await file.path())!, "utf8")).toBe(content);
    expect(mutations).toBe(0);
    expect(mediaRequests).toBe(0);
    await page
      .getByRole("button", { name: "Modifier la traduction", exact: true })
      .click();
    await expect(page).toHaveURL(/\/traduire$/);
    await expect(
      page.getByRole("textbox", { name: "Français one", exact: true }),
    ).toHaveValue("Traduction relue et conservée.");
    await expect(page.getByRole("button", { name: /Télécharger .*SRT/ })).toHaveCount(0);
    await expect(page.getByText("À propos de la traduction", { exact: true })).toHaveCount(0);
    await page.goto("/projets/fixture/corriger");
    await expect(page.getByRole("textbox", { name: "Arabe one", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Télécharger .*SRT/ })).toHaveCount(0);
    await expect(page.getByText("À propos de la traduction", { exact: true })).toHaveCount(0);
    await page.goto("/projets/fixture/traduire");
    await page
      .getByRole("button", { name: "Revenir à l’export", exact: true })
      .click();
    await expect(page).toHaveURL(/\/exporter$/);
    await expect(page.locator(".segments, video")).toHaveCount(0);
    expect(mutations).toBe(0);
  });
}

test("downloaded SRT groups short subtitles while review keeps separate edits", async ({
  page,
}) => {
  await page.goto("/projets");
  await page.getByRole("button", { name: "Compte test alice" }).click();
  const { project } = await (
    await page.request.get("/api/projects/fixture")
  ).json();
  if (project.stage === "arabic") {
    await page.goto("/projets/fixture/corriger");
    await page
      .getByRole("button", { name: "Valider et traduire", exact: true })
      .click();
  } else {
    await page.goto("/projets/fixture/traduire");
  }
  const first = page.getByRole("textbox", {
    name: "Français one",
    exact: true,
  });
  await expect(first).toBeVisible();
  await first.fill("Oui.");
  await page
    .getByRole("textbox", { name: "Français two", exact: true })
    .fill("Bienvenue à tous.");
  await page
    .getByRole("button", { name: "Valider et exporter", exact: true })
    .click();
  await expect(page).toHaveURL(/\/exporter$/);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Télécharger le français · SRT", exact: true })
    .click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/_fr\.srt$/);
  expect(await readFile((await file.path())!, "utf8")).toBe(
    "1\r\n00:00:00,000 --> 00:00:04,000\r\nOui. Bienvenue à tous.\r\n\r\n",
  );
  await page
    .getByRole("button", { name: "Modifier la traduction", exact: true })
    .click();
  await expect(first).toHaveValue("Oui.");
  await expect(
    page.getByRole("textbox", { name: "Français two", exact: true }),
  ).toHaveValue("Bienvenue à tous.");
  await expect(page.locator(".segment")).toHaveCount(2);
});
