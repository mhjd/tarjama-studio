import { test, expect } from "@playwright/test";
import type { Job, Project } from "../src/api";

// Hold raw and partially corrected data at the API boundary. No provider calls.
// Completion deliberately arrives without a reload, through the normal polling.
for (const [device, viewport] of Object.entries({
  desktop: { width: 1440, height: 932 },
  pixel6: { width: 412, height: 915 },
  iphone15: { width: 393, height: 852 },
})) {
  test(`${device}: correction locks raw text through waits, failures and reloads`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    const project: Project = {
      id: "fixture",
      title: "Vérification du verrouillage",
      stage: "transcribing",
      version: 1,
      arabic_version: 1,
      translation_source: 0,
      duration_ms: 4000,
      media: "fixture.mp4",
      segments: [
        {
          id: "one",
          start_ms: 0,
          end_ms: 2000,
          arabic: "نص خام لا تعدله",
          french: "",
          version: 1,
        },
        {
          id: "two",
          start_ms: 2000,
          end_ms: 4000,
          arabic: "تصحيح جزئي لا تعدله",
          french: "",
          version: 1,
        },
      ],
    };
    const job: Job = {
      id: "held-cleanup",
      kind: "transcribe",
      state: "running",
      progress: 50,
      message: "Transcription de test en cours",
      next_attempt_at: "",
      source_version: 1,
    };
    const writes: string[] = [];
    await page.route("**/api/projects/fixture/**", async (route) => {
      if (!["GET", "HEAD"].includes(route.request().method())) {
        writes.push(route.request().url());
        return route.abort();
      }
      await route.continue();
    });
    await page.route("**/api/projects/fixture", (route) =>
      route.fulfill({
        json: { project, jobs: [job] },
      }),
    );
    await page.goto("/projets/fixture/corriger");
    await page.getByRole("button", { name: "Compte test alice" }).click();

    const locked = async () => {
      await expect(page).toHaveURL(/\/preparer$/);
      await expect(
        page.getByText(/Vous pourrez relire et modifier l’arabe/),
      ).toBeVisible();
      // The project title remains editable; only subtitle inputs are locked.
      await expect(
        page.getByRole("textbox", { name: /^(Arabe|Français) / }),
      ).toHaveCount(0);
      await expect(
        page.getByText("نص خام لا تعدله", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("تصحيح جزئي لا تعدله", { exact: true }),
      ).toHaveCount(0);
      for (const n of [1, 2, 3])
        await expect(page.locator(".steps button").nth(n)).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Valider et traduire", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Suivi activé", exact: true }),
      ).toHaveCount(0);
    };
    await locked();
    project.stage = "cleaning";
    job.kind = "cleanup";
    for (const state of [
      "queued",
      "running",
      "waiting_provider",
      "failed",
      "cancelled",
    ]) {
      job.state = state;
      job.message = `Correction de test : ${state}`;
      // A direct future URL + reload cannot reveal stored partial results.
      await page.goto("/projets/fixture/traduire");
      await locked();
      await page.reload();
      await locked();
      if (state !== "cancelled")
        await expect(page.locator(".job")).toContainText(job.message);
      await page.screenshot({
        path: `test-results/correction-lock-${device}-${state}.png`,
        fullPage: true,
      });
    }
    // Structured-output recovery intentionally has no technical error message.
    job.state = "waiting_provider";
    job.message = "";
    await page.reload();
    await expect(page.locator(".job")).toContainText("Traitement en cours");
    await locked();

    project.stage = "arabic";
    project.segments[0].arabic = "النص المصحح جاهز للمراجعة";
    job.state = "succeeded";
    await expect(page).toHaveURL(/\/corriger$/);
    await expect(
      page.getByRole("textbox", { name: "Arabe one", exact: true }),
    ).toBeEditable();
    await expect(
      page.getByRole("textbox", { name: "Arabe one", exact: true }),
    ).toHaveValue("النص المصحح جاهز للمراجعة");
    await expect(
      page.getByRole("button", { name: "Valider et traduire", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".steps button").nth(2)).toBeDisabled();
    await page.screenshot({
      path: `test-results/correction-lock-${device}-completed.png`,
      fullPage: true,
    });
    expect(writes).toEqual([]);
  });
}
