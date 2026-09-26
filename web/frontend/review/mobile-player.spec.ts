import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";

// Read-only UI review. The API fixture is isolated; media/text are a previously
// qualified sample, not fresh provider results or the owner's live workspace.
for (const device of [
  { name: "iphone15", width: 393, height: 852, scale: 3 },
  { name: "pixel6", width: 412, height: 915, scale: 2.625 },
]) {
  test(`mobile player review ${device.name}`, async ({ browser }) => {
    const sample = JSON.parse(
      await readFile(process.env.MOBILE_REVIEW_TEXT!, "utf8"),
    );
    const dir = `../.cache/mobile-player-review/${device.name}`;
    await mkdir(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: device.scale,
      recordVideo: {
        dir,
        size: { width: device.width, height: device.height },
      },
    });
    const page = await context.newPage();
    const recording = page.video()!;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/projects/fixture", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        title: "France 24 · L’intelligence artificielle et ses réponses",
        stage: "review",
        url: sample.source,
        duration_ms: sample.duration_ms,
        segments: sample.segments,
        translation_source: data.project.arabic_version,
      });
      data.jobs = [];
      await route.fulfill({ response, json: data });
    });
    const measurements: unknown[] = [];
    const capture = async (name: string) => {
      // Deliberate reading pause for the recipient, not a readiness check.
      await page.waitForTimeout(2500);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      measurements.push({
        name,
        ...(await page.evaluate(() => {
          const player = document
            .querySelector(".player")!
            .getBoundingClientRect();
          const boxes = [
            ...document.querySelectorAll(".segment.active textarea"),
          ].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              language: el.getAttribute("lang"),
              top: r.top,
              height: r.height,
              visibleHeight: Math.max(
                0,
                Math.min(r.bottom, player.top) - Math.max(0, r.top),
              ),
            };
          });
          return {
            viewportHeight: innerHeight,
            playerHeight: player.height,
            playerTop: player.top,
            availableAbovePlayer: player.top,
            fields: boxes,
          };
        })),
      });
      await page.screenshot({ path: `${dir}/${name}.png`, scale: "css" });
    };
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Compte test alice" }).click();
      await page.getByRole("button", { name: /Cours d’arabe/ }).click();
      await expect(page.locator("video")).toHaveJSProperty("readyState", 4);
      await page.getByRole("button", { name: /2.*Corriger/ }).click();
      await capture("01-entree-correction");
      await page.getByRole("button", { name: "Lecture", exact: true }).click();
      await expect(page.locator("video")).toHaveJSProperty("paused", false);
      await page.waitForTimeout(5500);
      await capture("02-lecture-arabe-compacte");
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page
        .getByRole("slider", { name: "Position de lecture" })
        .fill("35");
      await capture("03-positionnement-arabe");
      await page.getByRole("button", { name: /3.*Traduire/ }).click();
      await expect(page.locator('textarea[lang="fr"]').first()).toBeVisible();
      await page
        .getByRole("slider", { name: "Position de lecture" })
        .fill("35.1");
      await capture("04-relecture-bilingue-compacte");
      await page.getByRole("button", { name: "Agrandir la vidéo" }).click();
      await expect(page.locator(".player")).toHaveClass(/expanded/);
      await page.getByRole("button", { name: "Lecture", exact: true }).click();
      await page.waitForTimeout(3000);
      await capture("05-video-agrandie");
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Réduire la vidéo" }).click();
      await page
        .getByRole("slider", { name: "Position de lecture" })
        .fill("35.2");
      await capture("06-retour-relecture-compacte");
      // Actual focus; desktop Chromium does not emulate the phone OS keyboard.
      await page.locator('.segment.active textarea[lang="fr"]').tap();
      await capture("07-champ-francais-selectionne");
      await page.locator('.segment.active textarea[lang="fr"]').blur();
      await page
        .getByRole("button", { name: "Aller en bas de la page", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Valider et exporter", exact: true }),
      ).toBeInViewport();
      await capture("08-validation-en-bas");
      expect(errors).toEqual([]);
      await writeFile(
        `${dir}/mesures.json`,
        JSON.stringify(measurements, null, 2),
      );
    } finally {
      await context.close();
      await recording.saveAs(`${dir}/lecteur-${device.name}.webm`);
    }
  });
}
