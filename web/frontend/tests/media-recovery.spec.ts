import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 932 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
]) {
  test(`recovery shows truthful states once and preserves edits at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    let state = "waiting_provider",
      progress = 16,
      restored = false,
      offline = false;
    let retries = 0,
      cancellations = 0,
      saves = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH") saves++;
    });
    await page.route("**/api/projects/fixture", async (route) => {
      if (offline) return route.abort();
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        stage: "review",
        translation_source: 1,
        arabic_version: 1,
        title: "Relecture — récupération de la vidéo",
        url: "https://www.youtube.com/watch?v=b1MKJ5gHig0",
        media_uploaded: false,
        ...(!restored ? { media: "", media_expired: true } : {}),
      });
      data.project.segments = Array.from({ length: 20 }, (_, i) => ({
        id: `recovery-${i}`,
        start_ms: i * 3000,
        end_ms: (i + 1) * 3000,
        arabic: "السلام عليكم ورحمة الله. مرحبا بكم في هذا اللقاء.",
        french: "Que la paix soit sur vous. Bienvenue à cette rencontre.",
        version: 1,
      }));
      data.jobs = restored
        ? []
        : [
            {
              id: "old",
              kind: "restore_download",
              state: "failed",
              generation: data.project.generation - 1,
              progress: 0,
            },
            {
              id: "restore",
              kind: "restore_download",
              state,
              generation: data.project.generation,
              progress,
              // Deliberately stale message: the visible state must come from state/progress.
              message:
                "Traitement média indisponible. Progression conservée ; reprise automatique.",
              next_attempt_at: new Date(Date.now() + 60000).toISOString(),
            },
          ];
      await route.fulfill({ response, json: data });
    });
    await page.route(
      "**/api/projects/fixture/jobs/restore/retry",
      async (route) => {
        retries++;
        state = "queued";
        await route.fulfill({ json: {} });
      },
    );
    await page.route(
      "**/api/projects/fixture/jobs/restore/cancel",
      async (route) => {
        cancellations++;
        state = "cancelled";
        await route.fulfill({ json: {} });
      },
    );
    await page.goto("/projets/fixture/traduire");
    const panel = page.getByRole("region", {
      name: "Lecteur indisponible",
      exact: true,
    });
    await expect(panel).toHaveCount(1);
    await expect(page.locator(".job")).toHaveCount(0);
    await expect(panel).toContainText("En attente du service vidéo");
    await expect(panel).toContainText(
      "Nouvelle tentative automatique prévue à",
    );
    await expect(panel.locator(".activity-spinner")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Réessayer", exact: true }),
    ).toHaveCount(0);
    await panel.getByText("Voir la progression", { exact: true }).click();
    await expect(panel.getByText("Terminée", { exact: true })).toHaveCount(1);
    await expect(panel.getByText("En cours", { exact: true })).toHaveCount(0);
    const first = page.getByRole("textbox", {
      name: "Français recovery-0",
      exact: true,
    });
    await first.scrollIntoViewIfNeeded();
    await panel.getByText("Voir la progression", { exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath(`compact-${viewport.width}.png`),
    });
    await panel.getByText("Voir la progression", { exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath(`waiting-${viewport.width}.png`),
    });
    state = "queued";
    await expect(panel).toContainText("Récupération en file d’attente");
    await expect(panel.locator(".activity-spinner")).toHaveCount(0);
    state = "running";
    await expect(panel).toContainText("Téléchargement de l’audio…");
    await expect(panel).toContainText("Étape 2 sur 6");
    await expect(panel).not.toContainText("Traitement média indisponible");
    await expect(panel.locator(".activity-spinner")).toHaveCount(1);
    await expect(panel.locator('[aria-current="step"]')).toContainText(
      "Téléchargement de l’audio",
    );
    await page.screenshot({
      path: testInfo.outputPath(`running-${viewport.width}.png`),
    });
    progress = 50;
    await expect(panel).toContainText("Étape 4 sur 6");
    await expect(panel.getByText("Terminée", { exact: true })).toHaveCount(3);
    offline = true;
    await expect(panel).toContainText("Connexion interrompue");
    await expect(panel.locator(".activity-spinner")).toHaveCount(0);
    await expect(panel.getByText("En cours", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button")).toHaveCount(0);
    offline = false;
    state = "failed";
    await panel
      .getByRole("button", { name: "Reprendre la récupération" })
      .click();
    await expect(panel).toContainText("Récupération en file d’attente");
    expect(retries).toBe(1);
    await panel
      .getByRole("button", { name: "Annuler la récupération" })
      .click();
    await expect(panel).toContainText("Récupération annulée");
    expect(cancellations).toBe(1);
    await panel
      .getByRole("button", { name: "Reprendre la récupération" })
      .click();
    await expect(panel).toContainText("Récupération en file d’attente");
    expect(retries).toBe(2);
    await panel.getByText("Voir la progression", { exact: true }).click();
    // The compact closed panel remains visible and leaves room for text on phones.
    const box = (await panel.boundingBox())!;
    expect(box.height).toBeLessThan(viewport.width <= 640 ? 175 : 200);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await first.fill("Ma correction non enregistrée");
    restored = true;
    await expect(
      page.getByRole("region", { name: "Lecteur vidéo", exact: true }),
    ).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect(first).toHaveValue("Ma correction non enregistrée");
    await expect(first).toBeFocused();
    expect(saves).toBe(0);
  });
}
