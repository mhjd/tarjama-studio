import { test, expect } from "@playwright/test";

for (const width of [320, 393, 412, 1440]) {
  test(`speed controls preserve transport centering at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 932 },
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.getByRole("button", { name: /Cours d’arabe/ }).click();
    const player = page.getByRole("region", { name: "Lecteur vidéo" });
    const video = page.locator("video");
    const speed = page.getByRole("combobox", { name: "Vitesse" });
    const play = page.getByRole("button", { name: "Lecture", exact: true });
    await expect(video).toHaveJSProperty("readyState", 4);
    await expect(speed).toHaveValue("1");
    const before = await play.boundingBox();
    for (const value of ["0.5", "1.25", "2", "1"]) {
      await speed.selectOption(value);
      await expect(video).toHaveJSProperty("playbackRate", Number(value));
      await expect(video).toHaveJSProperty("preservesPitch", true);
      const after = await play.boundingBox();
      expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
      expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
    }
    for (const expanded of [false, true]) {
      if (expanded)
        await page.getByRole("button", { name: "Agrandir la vidéo" }).click();
      const bounds = await player.boundingBox();
      const control = await play.boundingBox();
      expect(
        Math.abs(
          control!.x + control!.width / 2 - bounds!.x - bounds!.width / 2,
        ),
      ).toBeLessThan(1);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const settings = await speed.boundingBox();
      expect(settings!.y + settings!.height).toBeLessThanOrEqual(
        bounds!.y + bounds!.height,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await player.screenshot({
        path: `test-results/speed-${width}-${expanded ? "expanded" : "compact"}.png`,
      });
    }
    // Keyboard shortcuts use the media's current rate, not a stale React closure.
    await speed.evaluate((element) => element.blur());
    await page.keyboard.press("Shift+ArrowUp");
    await expect(speed).toHaveValue("1.25");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(video).toHaveJSProperty("playbackRate", 1.5);
    await page.keyboard.press("Shift+ArrowDown");
    await expect(video).toHaveJSProperty("playbackRate", 1.25);
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowUp");
    await expect(speed).toHaveValue("2");
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowDown");
    await expect(speed).toHaveValue("0.5");
    await page.getByRole("textbox", { name: "Arabe one", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowUp");
    await expect(video).toHaveJSProperty("playbackRate", 0.5);
    await context.close();
  });
}
