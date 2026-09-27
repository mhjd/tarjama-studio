import { test, expect } from "@playwright/test";

// A synthetic hour at one segment every three seconds. No provider calls and
// no live project data. CDP metrics distinguish rendering work from media I/O.
for (const width of [412, 1440]) {
  test(`long transcript rendering at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 915 });
    await page.goto("/projets");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.route("**/api/projects/fixture", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.project, {
        stage: "review",
        duration_ms: 3600000,
        translation_source: 1,
        arabic_version: 1,
      });
      data.project.segments = Array.from({ length: 1200 }, (_, n) => ({
        id: `long-${n}`,
        start_ms: n * 3000,
        end_ms: (n + 1) * 3000,
        arabic: "مرحبا بكم جميعا في هذا اللقاء. ".repeat(n % 10 === 9 ? 4 : 1),
        french: "Bienvenue à toutes et à tous dans cette rencontre. ".repeat(
          n % 10 === 9 ? 4 : 1,
        ),
        version: 1,
      }));
      await route.fulfill({ response, json: data });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const before = await cdp.send("Performance.getMetrics");
    const started = Date.now();
    await page.getByRole("button", { name: /Cours d’arabe/ }).click();
    await expect(page.locator(".segment")).toHaveCount(1200, {
      timeout: 90000,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const after = await cdp.send("Performance.getMetrics");
    const metrics = Object.fromEntries(
      after.metrics.map((m) => [
        m.name,
        m.value - (before.metrics.find((b) => b.name === m.name)?.value || 0),
      ]),
    );
    const result = {
      width,
      segments: 1200,
      elapsed_ms: Date.now() - started,
      layout_count: metrics.LayoutCount,
      layout_seconds: metrics.LayoutDuration,
      script_seconds: metrics.ScriptDuration,
      task_seconds: metrics.TaskDuration,
    };
    console.log("LONG_TRANSCRIPT", JSON.stringify(result));
    // Catch a return to per-field forced layouts without a machine-speed limit.
    expect(result.layout_count).toBeLessThan(100);
    await testInfo.attach("rendering.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    // The final, long caption remains editable and fully readable on mobile.
    const last = page.getByRole("textbox", {
      name: "Français long-1199",
      exact: true,
    });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeEditable();
    if (width <= 640)
      expect(
        await last.evaluate((el) => el.scrollHeight - el.clientHeight),
      ).toBeLessThanOrEqual(1);
    if (width <= 640) {
      await page.setViewportSize({ width: width - 12, height: 915 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      // Do not use a locator action that would silently scroll back to the field.
      expect(
        await last.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        }),
      ).toBe(true);
      expect(
        await last.evaluate((el) => el.scrollHeight - el.clientHeight),
      ).toBeLessThanOrEqual(1);
    }
    await expect(page.locator("video")).toHaveAttribute("preload", "metadata");
    const media = await page.request.get("/api/projects/fixture/media", {
      headers: { Range: "bytes=0-1023" },
    });
    expect(media.status()).toBe(206);
    expect(media.headers()["accept-ranges"]).toBe("bytes");
    expect((await media.body()).length).toBe(1024);
  });
}
