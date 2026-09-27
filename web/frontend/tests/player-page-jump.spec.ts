import { test, expect, type Page } from "@playwright/test";

test.use({ hasTouch: true });

async function controlsAreReachable(page: Page) {
  // Inspect without locator.click(): Playwright would scroll an obscured control
  // into view, hiding exactly the regression we want to detect.
  const result = await page.evaluate(() => {
    const viewport = window.visualViewport!;
    return [".player-timeline input", ".player-options-toggle"].map(
      (selector) => {
        const control = document.querySelector(selector)!;
        const rect = control.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return {
          visible:
            rect.top >= viewport.offsetTop &&
            rect.bottom <= viewport.offsetTop + viewport.height,
          reachable: hit !== null && control.contains(hit),
        };
      },
    );
  });
  expect(result).toEqual([
    { visible: true, reachable: true },
    { visible: true, reachable: true },
  ]);
}

for (const width of [393, 412]) {
  for (const changingViewport of [false, true]) {
    test(`page jump keeps the bottom controls reachable at ${width}px, simulated toolbar=${changingViewport}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 915 });
      await page.goto("/projets");
      await page.getByRole("button", { name: "Compte test alice" }).click();
      await page.route("**/api/projects/fixture", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.project.stage = "arabic";
        data.project.segments = Array.from({ length: 35 }, (_, n) => ({
          id: `jump-${n}`,
          start_ms: n * 100,
          end_ms: (n + 1) * 100,
          arabic: "السلام عليكم",
          french: "",
          version: 1,
        }));
        await route.fulfill({ response, json: data });
      });
      await page.getByRole("button", { name: /Cours d’arabe/ }).click();
      const options = page.getByRole("button", { name: /Options ·/ });
      for (const direction of ["bas", "haut", "bas"]) {
        await options.tap();
        await page
          .getByRole("button", {
            name: `Aller en ${direction} de la page`,
            exact: true,
          })
          .tap();
        await expect(options).toHaveAttribute("aria-expanded", "false");
        // Model a toolbar shrinking only the visual viewport after the jump.
        // This is a controlled geometry test, not Android browser-chrome emulation.
        if (changingViewport)
          await page.evaluate(() => {
            Object.defineProperty(window.visualViewport!, "height", {
              configurable: true,
              value: innerHeight - 80,
            });
            window.visualViewport!.dispatchEvent(new Event("resize"));
          });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await controlsAreReachable(page);
        await expect(options).toBeFocused();
        await expect(page.locator("video")).toHaveJSProperty("paused", true);
        // Repeated notifications must not accumulate an offset.
        await page.evaluate(() =>
          window.visualViewport!.dispatchEvent(new Event("scroll")),
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        await controlsAreReachable(page);
        if (changingViewport) {
          await page.evaluate(() => {
            delete (window.visualViewport as unknown as { height?: number })
              .height;
            window.visualViewport!.dispatchEvent(new Event("resize"));
          });
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              ),
          );
          const gap = await page
            .locator(".player")
            .evaluate(
              (element) => innerHeight - element.getBoundingClientRect().bottom,
            );
          expect(gap).toBeCloseTo(8, 0);
        }
      }
      await page.screenshot({
        path: `test-results/player-bas-${width}-${changingViewport}.png`,
      });
    });
  }
}
