import { test, expect } from "@playwright/test";

for (const width of [1440, 393, 412]) {
  test(`export waits for recovery without blocking subtitles at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 915 });
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    let state = "queued",
      recovered = false,
      legacyExport = false,
      requests = 0;
    await page.route("**/api/projects/fixture", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        stage: "ready",
        translation_source: 1,
        confirmed_review: data.project.version,
        url: "https://www.youtube.com/watch?v=b1MKJ5gHig0",
        media_uploaded: false,
        ...(!recovered ? { media: "", media_expired: true } : {}),
      });
      data.project.segments.forEach((s: { french: string }) => {
        s.french = "Texte conservé";
      });
      data.jobs = [
        {
          id: "old-export",
          kind: "export_fr_high",
          state: "failed",
          generation: data.project.generation - 1,
          source_version: data.project.version,
          progress: 0,
        },
        {
          id: "restore",
          kind: "restore_download",
          state: recovered ? "succeeded" : state,
          generation: data.project.generation,
          progress: 16,
        },
        // A later queued export from the old UI must not hide the active recovery.
        {
          id: "export",
          kind: "export_fr_low",
          state: legacyExport ? "queued" : "failed",
          generation: data.project.generation,
          source_version: data.project.version,
          progress: 0,
        },
      ];
      await route.fulfill({ response, json: data });
    });
    await page.route("**/api/projects/fixture/exports", async (route) => {
      requests++;
      await route.fulfill({ json: {} });
    });
    await page.route(
      "**/api/projects/fixture/jobs/export/retry",
      async (route) => {
        requests++;
        await route.fulfill({ json: {} });
      },
    );
    await page.goto("/projets/fixture/exporter");
    const panel = page.locator(".export-panel");
    for (const next of ["queued", "running", "waiting_provider"]) {
      state = next;
      const recovery = page.getByRole("region", {
        name: "Lecteur indisponible",
      });
      await expect(recovery).toContainText(
        next === "queued"
          ? "Récupération en file d’attente"
          : next === "running"
            ? "Téléchargement de l’audio…"
            : "En attente du service vidéo",
      );
      for (const quality of ["low", "high"]) {
        await panel.getByLabel("Qualité").selectOption(quality);
        await expect(
          panel.getByRole("button", {
            name: "En attente de la vidéo",
            exact: true,
          }),
        ).toBeDisabled();
      }
      await expect(panel).toContainText("Attendez la fin de la récupération");
      await expect(
        page.getByRole("button", { name: "Réessayer", exact: true }),
      ).toBeDisabled();
    }
    expect(requests).toBe(0);
    await expect(
      page.getByRole("heading", {
        name: "Exporter les sous-titres",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Télécharger le français · SRT" }),
    ).toBeEnabled();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`export-waits-${width}.png`),
    });
    state = "running";
    legacyExport = true;
    await panel.getByLabel("Qualité").selectOption("low");
    await expect(panel).toContainText(
      "La création attend la fin de la récupération",
    );
    await expect(
      page.getByRole("region", { name: "Lecteur indisponible" }),
    ).toContainText("Téléchargement de l’audio…");
    legacyExport = false;
    recovered = true;
    await panel.getByLabel("Qualité").selectOption("high");
    await expect(
      panel.getByRole("button", { name: "Créer la vidéo", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "Créer la vidéo", exact: true })
      .click();
    expect(requests).toBe(1);
  });
}
