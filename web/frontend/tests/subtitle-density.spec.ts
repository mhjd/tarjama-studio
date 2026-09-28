import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 932 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
]) {
  test(`subtitles fit their text and retain the player at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.route("**/api/projects/fixture", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        stage: "review",
        translation_source: 1,
        arabic_version: 1,
        title: "Relecture arabe et français",
      });
      data.project.segments = Array.from({ length: 12 }, (_, n) => ({
        id: `density-${n}`,
        start_ms: n * 3000,
        end_ms: (n + 1) * 3000,
        arabic: "السلام عليكم ورحمة الله. مرحبا بكم في هذا اللقاء.",
        french:
          "Que la paix et la miséricorde de Dieu soient sur vous. Bienvenue à cette rencontre.",
        version: 1,
      }));
      await route.fulfill({ response, json: data });
    });
    await page.goto("/projets/fixture/traduire");
    const rows = page.locator(".segment");
    await expect(rows).toHaveCount(12);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const french = page.getByRole("textbox", {
      name: "Français density-0",
      exact: true,
    });
    const arabic = page.getByRole("textbox", {
      name: "Arabe density-0",
      exact: true,
    });
    const initialHeight = (await french.boundingBox())!.height;
    if (viewport.width > 640) {
      expect(initialHeight).toBeLessThan(70);
      expect((await arabic.boundingBox())!.height).toBeLessThan(90);
      expect((await rows.first().boundingBox())!.height).toBeLessThan(240);
    }
    expect((await french.boundingBox())!.y).toBeGreaterThan(
      (await arabic.boundingBox())!.y,
    );

    // Long edits grow; shortening shrinks again, without hiding any text.
    const original = await french.inputValue();
    await french.fill(original.repeat(15));
    await expect
      .poll(async () => (await french.boundingBox())!.height)
      .toBeGreaterThan(initialHeight + 50);
    expect(
      await french.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeLessThanOrEqual(1);
    await french.fill(original);
    await expect
      .poll(async () => (await french.boundingBox())!.height)
      .toBe(initialHeight);
    await french.blur();
    if (viewport.width <= 640) {
      const timestamp = rows.first().getByRole("button");
      const timeBox = (await timestamp.boundingBox())!;
      expect(timeBox.height).toBeGreaterThanOrEqual(44);
      expect(timeBox.y + timeBox.height).toBeLessThanOrEqual(
        (await arabic.boundingBox())!.y,
      );
      expect(
        await arabic.evaluate((el) => getComputedStyle(el).borderColor),
      ).not.toBe(
        await french.evaluate((el) => getComputedStyle(el).borderColor),
      );
    }

    // Use real window scrolling, not a locator visibility check (which also
    // considers a player positioned entirely outside the viewport "visible").
    const player = page.getByRole("region", { name: "Lecteur vidéo" });
    for (const index of [0, 6, 11]) {
      await rows
        .nth(index)
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      await expect
        .poll(async () => {
          const box = (await player.boundingBox())!;
          return box.y >= 0 && box.y + box.height <= viewport.height;
        })
        .toBe(true);
    }
    await rows.first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    expect(
      (await rows.first().getByRole("button").boundingBox())!.y,
    ).toBeGreaterThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`subtitles-${viewport.width}.png`),
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    if (viewport.width > 640) {
      const readable = await rows.evaluateAll(
        (elements) =>
          elements.filter((el) => {
            const rect = el.getBoundingClientRect();
            const bottom = document
              .querySelector(".player")!
              .getBoundingClientRect().bottom;
            return rect.top >= bottom && rect.bottom <= innerHeight;
          }).length,
      );
      expect(readable).toBeGreaterThanOrEqual(2);
    }
  });
}

for (const width of [1440, 393, 412]) {
  for (const uploaded of [false, true]) {
    test(`expired ${uploaded ? "upload" : "YouTube"} has a persistent recovery action at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 915 });
      await page.goto("/projets");
      await page.getByRole("button", { name: "Compte test alice" }).click();
      let requests = 0;
      let restoring = false;
      let restored = false;
      let expired: Record<string, unknown>;
      await page.route("**/api/projects/fixture", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        Object.assign(data.project, {
          stage: "review",
          translation_source: 1,
          arabic_version: 1,
          media_uploaded: uploaded,
          url: uploaded ? "" : "https://www.youtube.com/watch?v=b1MKJ5gHig0",
        });
        if (!restored)
          Object.assign(data.project, { media: "", media_expired: true });
        data.project.segments = Array.from({ length: 20 }, (_, n) => ({
          id: `expired-${n}`,
          start_ms: n * 3000,
          end_ms: (n + 1) * 3000,
          arabic: "مرحبا بكم جميعا في هذا اللقاء.",
          french: "Bienvenue à cette rencontre.",
          version: 1,
        }));
        data.jobs =
          restoring && !restored
            ? [
                {
                  id: "restore",
                  kind: "restore_media",
                  state: "running",
                  generation: data.project.generation,
                  progress: 0,
                  message: "",
                },
              ]
            : [];
        expired = data.project;
        await route.fulfill({ response, json: data });
      });
      await page.route(
        "**/api/projects/fixture/media/restore",
        async (route) => {
          requests++;
          restoring = true;
          await route.fulfill({ json: expired });
        },
      );
      await page.goto("/projets/fixture/traduire");
      const last = page.getByRole("textbox", {
        name: "Français expired-19",
        exact: true,
      });
      await last.scrollIntoViewIfNeeded();
      const notice = page.getByRole("region", {
        name: "Lecteur indisponible",
        exact: true,
      });
      await expect(notice).toContainText("Vidéo expirée");
      await expect
        .poll(async () => {
          const box = (await notice.boundingBox())!;
          return box.y >= 0 && box.y + box.height <= 915;
        })
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `expired-${uploaded ? "upload" : "youtube"}-${width}.png`,
        ),
      });
      if (uploaded) {
        await notice
          .getByRole("button", { name: "Réimporter la vidéo", exact: true })
          .click();
        await expect(
          page.getByLabel("Réimporter la vidéo originale"),
        ).toBeFocused();
        expect(requests).toBe(0);
      } else {
        const recover = notice.getByRole("button", {
          name: "Récupérer la vidéo",
          exact: true,
        });
        await recover.click();
        await expect(notice).toContainText("Récupération de la vidéo…");
        await expect(recover).toBeDisabled();
        expect(requests).toBe(1);
        restored = true;
        await expect(
          page.getByRole("region", { name: "Lecteur vidéo", exact: true }),
        ).toBeVisible();
        await expect(notice).toHaveCount(0);
        await expect(page.locator("video")).toHaveAttribute(
          "src",
          "/api/projects/fixture/media",
        );
      }
      await expect(last).toHaveValue("Bienvenue à cette rencontre.");
    });
  }
}
