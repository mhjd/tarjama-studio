import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 932 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
]) {
  test(`player contains injected controls at ${viewport.width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Compte test alice" }).click();
    await page.getByRole("button", { name: /Cours d’arabe/ }).click();
    const player = page.getByRole("region", { name: "Lecteur vidéo" });
    const play = page.getByRole("button", { name: "Lecture", exact: true });
    await expect(play).toBeVisible();
    await expect(page.locator("video")).toHaveJSProperty("playbackRate", 1);
    const before = await play.boundingBox();
    const playerBefore = await player.boundingBox();
    await player.screenshot({
      path: `test-results/player-${viewport.width}-normal.png`,
    });
    // An extension inserts a shadow host next to <video>. Its controls are not app UI.
    await page.locator("video").evaluate((video) => {
      const host = document.createElement("div");
      host.className = "vsc-controller";
      host.attachShadow({ mode: "open" }).innerHTML =
        "<span>2.20 <button>«</button> <button>−</button> <button>+</button> <button>»</button> <button>×</button></span>";
      video.before(host);
    });
    await player.screenshot({
      path: `test-results/player-${viewport.width}-injected.png`,
    });
    const after = await play.boundingBox();
    const playerAfter = await player.boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
    expect(Math.abs(playerAfter!.height - playerBefore!.height)).toBeLessThan(
      1,
    );
    await page.getByRole("button", { name: "Agrandir la vidéo" }).click();
    await expect(
      page.getByRole("button", { name: "Réduire la vidéo" }),
    ).toBeVisible();
    const expanded = await player.boundingBox();
    const video = await page.locator("video").boundingBox();
    expect(video!.y + video!.height).toBeLessThanOrEqual(
      (await play.boundingBox())!.y,
    );
    expect(expanded!.x).toBeGreaterThanOrEqual(0);
    expect(expanded!.x + expanded!.width).toBeLessThanOrEqual(viewport.width);
    await player.screenshot({
      path: `test-results/player-${viewport.width}-expanded.png`,
    });
    await context.close();
  });
}
