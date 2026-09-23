import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Local UI evidence: real persistence/media/export, synthetic source and AI fixtures.
for (const device of [
  {
    name: "macbook-air15",
    viewport: { width: 1440, height: 932 },
    isMobile: false,
    hasTouch: false,
  },
  {
    name: "pixel6",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "iphone15",
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  },
]) {
  test(`record full UI journey ${device.name}`, async ({ browser }) => {
    test.setTimeout(90000);
    const { name, ...options } = device;
    const dir = `test-results/journey-${name}`;
    await mkdir(dir, { recursive: true });
    const context = await browser.newContext({
      ...options,
      acceptDownloads: true,
      recordVideo: { dir, size: device.viewport },
    });
    const page = await context.newPage();
    const recording = page.video()!;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const mark = async (step: string) => {
      // Intentional reading time in the review recording, not a synchronization wait.
      await page.waitForTimeout(1200);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({ path: `${dir}/${step}.png` });
    };
    try {
      await page.goto("/");
      await page.getByRole("button", { name: "Compte test alice" }).click();
      await expect(
        page.getByRole("heading", { name: "Mes projets" }),
      ).toBeVisible();
      await mark("01-projets");
      await page.getByRole("button", { name: "+ Nouvelle vidéo" }).click();
      await page
        .getByRole("button", { name: "Importer une vidéo", exact: true })
        .click();
      await page
        .getByLabel("Titre", { exact: true })
        .fill(`Test interface · ${name}`);
      await page
        .getByLabel("Vidéo de votre appareil")
        .setInputFiles("/tmp/tarjama-storage/fixture.mp4");
      await mark("02-import");
      await page.getByRole("button", { name: "Commencer" }).click();
      await expect(
        page.getByRole("heading", { name: "Correction arabe" }),
      ).toBeVisible({ timeout: 30000 });
      const video = page.locator("video");
      await expect(video).toHaveJSProperty("playbackRate", 1);
      await page.getByRole("button", { name: "Lecture", exact: true }).click();
      await expect(video).toHaveJSProperty("paused", false);
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("slider", { name: "Position de lecture" }).fill("1");
      await page
        .getByRole("button", { name: "Suivi activé", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Suivi désactivé" }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Suivi désactivé" }).click();
      await mark("03-lecteur");
      await page.getByRole("button", { name: "Agrandir la vidéo" }).click();
      await mark("04-video-agrandie");
      await page.getByRole("button", { name: "Réduire la vidéo" }).click();
      await page
        .locator('textarea[lang="ar"]')
        .first()
        .fill("مرحبا بكم جميعا.");
      await page.locator('textarea[lang="ar"]').first().blur();
      await expect(page.locator('.page-title [role="status"]')).toContainText(
        "Enregistré",
      );
      await page.getByRole("link", { name: "Aller à la validation" }).click();
      await mark("05-validation-arabe");
      await page
        .getByRole("button", { name: "Valider et traduire", exact: true })
        .click();
      const french = page.locator('textarea[lang="fr"]').first();
      await expect(french).toBeVisible({ timeout: 30000 });
      await french.fill("Bonjour à toutes et à tous.");
      await french.blur();
      await expect(page.locator('.page-title [role="status"]')).toContainText(
        "Enregistré",
      );
      await mark("06-relecture-francaise");
      await page
        .getByRole("button", { name: "Valider et exporter", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: /Qualité/ })
        .selectOption("high");
      await mark("07-export-high");
      await page.getByRole("button", { name: "Créer la vidéo" }).click();
      const link = page.getByRole("link", {
        name: "Télécharger · High · français",
        exact: true,
      });
      await expect(link).toBeVisible({ timeout: 30000 });
      const downloadPromise = page.waitForEvent("download");
      await link.click();
      const download = await downloadPromise;
      await download.saveAs(`${dir}/sous-titres-test-${name}-fr-high.mp4`);
      expect(await download.failure()).toBeNull();
      await mark("08-telechargement");
      await french.fill("Bonjour à tous, voici le texte corrigé.");
      await french.blur();
      await expect(link).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Valider et exporter", exact: true }),
      ).toBeVisible();
      await mark("09-correction-apres-export");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await recording.saveAs(`${dir}/parcours-${name}.webm`);
    }
  });
}
