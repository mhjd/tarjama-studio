import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Synthetic media/AI, real persistence and exports. Paid semantic qualification
// uses the application functions separately in the recorded Sirat benchmark.
test("inline references remain editable and survive SRT and video export", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Compte test alice" }).click();
  await page.getByRole("button", { name: "+ Nouvelle vidéo" }).click();
  await page.getByRole("button", { name: "Importer une vidéo", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill("Références entre parenthèses");
  await page.getByLabel("Vidéo de votre appareil").setInputFiles("/tmp/tarjama-storage/fixture.mp4");
  await page.getByRole("button", { name: "Commencer" }).click();
  await expect(page.getByRole("button", { name: "Valider et traduire", exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Valider et traduire", exact: true }).click();
  const french = page.locator('textarea[lang="fr"]').first();
  await expect(french).toBeVisible({ timeout: 30000 });
  const quote = "« Et ne tuez pas vos enfants par crainte de pauvreté » (sourate 17, verset 31).";
  await french.fill(quote);
  await french.blur();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  await page.reload();
  await expect(french).toHaveValue(quote);
  await page.getByRole("button", { name: "Valider et exporter", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger le français · SRT", exact: true }).click();
  const srt = await download;
  const text = await readFile((await srt.path())!, "utf8");
  expect(text.replace(/\s+/g, " ")).toContain(quote);
  await page.getByRole("button", { name: "Créer la vidéo", exact: true }).click();
  const link = page.getByRole("link", { name: "Télécharger la vidéo", exact: true });
  await expect(link).toBeVisible({ timeout: 30000 });
  const video = await page.request.get((await link.getAttribute("href"))!);
  expect(video.status()).toBe(200);
  expect((await video.body()).length).toBeGreaterThan(1000);
});
